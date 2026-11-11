import os
import time
from contextlib import asynccontextmanager

# Decompression-bomb guard: must be set before OpenCV is imported.
os.environ.setdefault("OPENCV_IO_MAX_IMAGE_PIXELS", str(60_000_000))
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
import base64
import hmac
import anyio
import cv2
from . import compare as cmp, forensics, holder, microprint, ocr, quality, seam, telemetry, template, uv, video
from .codes import decode_codes
from .geometry import parse_geometry
from .imaging import decode, limit

# Match OpenCV's thread pool to the container CPU limit (it otherwise sizes to the node's cores and is
# throttled under a k8s CPU limit). VISION_THREADS=0/unset keeps OpenCV's default.
if int(os.environ.get("VISION_THREADS", "0") or 0) > 0:
    cv2.setNumThreads(int(os.environ["VISION_THREADS"]))

def jsonable(v):
    """NumPy scalars/arrays → plain Python so FastAPI can serialize every analysis result."""
    import numpy as np
    if isinstance(v, dict):
        return {k: jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [jsonable(x) for x in v]
    if isinstance(v, np.generic):
        return v.item()
    if isinstance(v, np.ndarray):
        return v.tolist()
    return v


MAX_BYTES = int(os.getenv("VISION_MAX_BYTES", str(15 * 1024 * 1024)))
@asynccontextmanager
async def _lifespan(_app):
    if key_required() and not os.getenv("VISION_API_KEY"):
        raise RuntimeError("Refusing to start: VISION_API_KEY is required on deployed instances")
    """Load the OCR models before serving (otherwise each new pod's first analysis takes ~3 s longer).
    Readiness probes only pass once this is done, so autoscaled pods join warm."""
    if os.environ.get("VISION_WARMUP", "1") != "0":
        import numpy as np
        ocr.read_text(np.full((64, 256, 3), 255, np.uint8))
    yield


app = FastAPI(title="SlabGuard Vision", version="0.1.0", lifespan=_lifespan)
telemetry.setup(app)


def key_required() -> bool:
    """Deployed instances must have a key (Fly sets FLY_APP_NAME); local dev and tests may run without."""
    return bool(os.getenv("FLY_APP_NAME")) or os.getenv("VISION_REQUIRE_KEY") == "1"


def auth(x_vision_key: str | None = Header(default=None)):
    key = os.getenv("VISION_API_KEY")
    if not key:
        if key_required():  # fail closed if a deployed instance somehow lost its key
            raise HTTPException(503, "vision key not configured")
        return
    if not x_vision_key or not hmac.compare_digest(x_vision_key.encode(), key.encode()):  # constant-time
        raise HTTPException(401, "invalid vision key")


_limiter = None


async def cpu(fn, *args):
    """Run CPU-bound analysis on a worker thread so the event loop stays free (health/readiness probes keep
    answering while an analysis runs). VISION_CONCURRENCY analyses run at once per process (default 1:
    OpenCV already uses VISION_THREADS cores per call, so more would only oversubscribe the CPU limit)."""
    global _limiter
    if _limiter is None:
        _limiter = anyio.CapacityLimiter(int(os.environ.get("VISION_CONCURRENCY", "1")))
    # Span covers waiting for a free analysis slot + the work itself (shows queueing inside a busy pod).
    with telemetry.span(f"vision.{getattr(fn, '__qualname__', 'work')}"):
        return await anyio.to_thread.run_sync(lambda: fn(*args), limiter=_limiter)


def _decode_limited(data: bytes):
    return limit(decode(data))[0]


async def load(f: UploadFile):
    data = await f.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "image too large")
    try:
        return await cpu(_decode_limited, data)
    except ValueError as e:
        raise HTTPException(422, str(e))


@app.get("/health")
def health():
    from .versions import TOOL_VERSIONS
    return {"ok": True, "ocr": ocr.available(), "version": app.version, "tools": TOOL_VERSIONS}


@app.post("/quality", dependencies=[Depends(auth)])
async def quality_ep(image: UploadFile = File(...), role: str = Form("front"), geometry: str | None = Form(None)):
    t = time.perf_counter()
    item_rng, holder_rng = parse_geometry(geometry)
    r = await cpu(quality.assess, await load(image), role, item_rng, holder_rng)
    r["elapsedMs"] = round((time.perf_counter() - t) * 1000)
    return r


@app.post("/extract", dependencies=[Depends(auth)])
async def extract_ep(image: UploadFile = File(...)):
    img = await load(image)
    return await cpu(lambda: {"codes": decode_codes(img), "ocr": ocr.read_text(img)})


@app.post("/compare", dependencies=[Depends(auth)])
async def compare_ep(upload: UploadFile = File(...), reference: UploadFile = File(...), upload_label_text: str | None = Form(None), geometry: str | None = Form(None)):
    t = time.perf_counter()
    item_rng, holder_rng = parse_geometry(geometry)
    r = await cpu(cmp.compare, await load(upload), await load(reference), upload_label_text.split("\n") if upload_label_text else None, item_rng, holder_rng)
    r["elapsedMs"] = round((time.perf_counter() - t) * 1000)
    return r


@app.post("/holder", dependencies=[Depends(auth)])
async def holder_ep(
    front: UploadFile = File(...),
    label: UploadFile | None = File(None),
    tilt: list[UploadFile] | None = File(None),
    normal: UploadFile | None = File(None),
    backlit: UploadFile | None = File(None),
    geometry: str | None = Form(None),
):
    t = time.perf_counter()
    frames = [await load(f) for f in (tilt or [])][:12]
    pair = (await load(normal), await load(backlit)) if normal and backlit else None
    _, holder_rng = parse_geometry(geometry)
    r = await cpu(holder.inspect, await load(front), await load(label) if label else None, frames, pair, holder_rng)
    r["elapsedMs"] = round((time.perf_counter() - t) * 1000)
    return r


MAX_VIDEO_BYTES = int(os.getenv("VISION_MAX_VIDEO_BYTES", str(60 * 1024 * 1024)))


@app.post("/frames", dependencies=[Depends(auth)])
async def frames_ep(video_file: UploadFile = File(...), k: int = Form(6)):
    data = await video_file.read()
    if len(data) > MAX_VIDEO_BYTES:
        raise HTTPException(413, "video too large")
    try:
        r = await cpu(video.extract_frames, data, max(3, min(k, 10)))
    except ValueError as e:
        raise HTTPException(422, str(e))
    for f in r["frames"]:
        f["jpeg"] = base64.b64encode(f["jpeg"]).decode()
    return r


@app.post("/edge", dependencies=[Depends(auth)])
async def edge_ep(image: UploadFile = File(...)):
    return await cpu(seam.review_edge, await load(image))


@app.post("/forensics", dependencies=[Depends(auth)])
async def forensics_ep(image: UploadFile = File(...)):
    return jsonable(await cpu(forensics.analyze, await load(image)))


@app.post("/uv", dependencies=[Depends(auth)])
async def uv_ep(image: UploadFile = File(...), template_image: UploadFile | None = File(None)):
    return jsonable(await cpu(uv.analyze, await load(image), await load(template_image) if template_image else None))


@app.post("/microprint", dependencies=[Depends(auth)])
async def microprint_ep(image: UploadFile = File(...), template_image: UploadFile | None = File(None)):
    return jsonable(await cpu(microprint.analyze, await load(image), await load(template_image) if template_image else None))


@app.post("/label-template", dependencies=[Depends(auth)])
async def label_template_ep(image: UploadFile = File(...), template_image: UploadFile | None = File(None), geometry: str | None = Form(None)):
    item_rng, holder_rng = parse_geometry(geometry)
    img = await load(image)
    tpl = await load(template_image) if template_image else None
    def run():
        out = {"proportions": template.proportions(img, holder_rng), "itemHash": template.item_hash(img, item_rng)}
        if tpl is not None:
            out["label"] = template.compare_label(img, tpl, holder_rng)
        return out
    out = await cpu(run)
    return jsonable(out)


@app.post("/label-crop", dependencies=[Depends(auth)])
async def label_crop_ep(image: UploadFile = File(...), geometry: str | None = Form(None)):
    """Normalised label crop used to register a verified template (staff tooling)."""
    _, holder_rng = parse_geometry(geometry)
    lab, _ = await cpu(template.label_crop, await load(image), holder_rng)
    if lab is None:
        raise HTTPException(422, "label region not found")
    return {"jpeg": base64.b64encode(cv2.imencode(".jpg", lab, [cv2.IMWRITE_JPEG_QUALITY, 95])[1].tobytes()).decode()}
