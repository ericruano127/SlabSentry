import os
import time

# Decompression-bomb guard: must be set before OpenCV is imported.
os.environ.setdefault("OPENCV_IO_MAX_IMAGE_PIXELS", str(60_000_000))
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
import base64
import cv2
from . import compare as cmp, forensics, holder, microprint, ocr, quality, seam, template, uv, video
from .codes import decode_codes
from .geometry import parse_geometry
from .imaging import decode, limit

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
app = FastAPI(title="SlabGuard Vision", version="0.1.0")


def auth(x_vision_key: str | None = Header(default=None)):
    key = os.getenv("VISION_API_KEY")
    if key and x_vision_key != key:
        raise HTTPException(401, "invalid vision key")


async def load(f: UploadFile):
    data = await f.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "image too large")
    try:
        return limit(decode(data))[0]
    except ValueError as e:
        raise HTTPException(422, str(e))


@app.get("/health")
def health():
    return {"ok": True, "ocr": ocr.available(), "version": app.version}


@app.post("/quality", dependencies=[Depends(auth)])
async def quality_ep(image: UploadFile = File(...), role: str = Form("front"), geometry: str | None = Form(None)):
    t = time.perf_counter()
    item_rng, holder_rng = parse_geometry(geometry)
    r = quality.assess(await load(image), role, item_rng, holder_rng)
    r["elapsedMs"] = round((time.perf_counter() - t) * 1000)
    return r


@app.post("/extract", dependencies=[Depends(auth)])
async def extract_ep(image: UploadFile = File(...)):
    img = await load(image)
    return {"codes": decode_codes(img), "ocr": ocr.read_text(img)}


@app.post("/compare", dependencies=[Depends(auth)])
async def compare_ep(upload: UploadFile = File(...), reference: UploadFile = File(...), upload_label_text: str | None = Form(None), geometry: str | None = Form(None)):
    t = time.perf_counter()
    item_rng, holder_rng = parse_geometry(geometry)
    r = cmp.compare(await load(upload), await load(reference), upload_label_text.split("\n") if upload_label_text else None, item_rng, holder_rng)
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
    r = holder.inspect(await load(front), await load(label) if label else None, frames, pair, holder_rng)
    r["elapsedMs"] = round((time.perf_counter() - t) * 1000)
    return r


MAX_VIDEO_BYTES = int(os.getenv("VISION_MAX_VIDEO_BYTES", str(60 * 1024 * 1024)))


@app.post("/frames", dependencies=[Depends(auth)])
async def frames_ep(video_file: UploadFile = File(...), k: int = Form(6)):
    data = await video_file.read()
    if len(data) > MAX_VIDEO_BYTES:
        raise HTTPException(413, "video too large")
    try:
        r = video.extract_frames(data, max(3, min(k, 10)))
    except ValueError as e:
        raise HTTPException(422, str(e))
    for f in r["frames"]:
        f["jpeg"] = base64.b64encode(f["jpeg"]).decode()
    return r


@app.post("/edge", dependencies=[Depends(auth)])
async def edge_ep(image: UploadFile = File(...)):
    return seam.review_edge(await load(image))


@app.post("/forensics", dependencies=[Depends(auth)])
async def forensics_ep(image: UploadFile = File(...)):
    return jsonable(forensics.analyze(await load(image)))


@app.post("/uv", dependencies=[Depends(auth)])
async def uv_ep(image: UploadFile = File(...), template_image: UploadFile | None = File(None)):
    return jsonable(uv.analyze(await load(image), await load(template_image) if template_image else None))


@app.post("/microprint", dependencies=[Depends(auth)])
async def microprint_ep(image: UploadFile = File(...), template_image: UploadFile | None = File(None)):
    return jsonable(microprint.analyze(await load(image), await load(template_image) if template_image else None))


@app.post("/label-template", dependencies=[Depends(auth)])
async def label_template_ep(image: UploadFile = File(...), template_image: UploadFile | None = File(None), geometry: str | None = Form(None)):
    item_rng, holder_rng = parse_geometry(geometry)
    img = await load(image)
    out = {"proportions": template.proportions(img, holder_rng), "itemHash": template.item_hash(img, item_rng)}
    if template_image:
        out["label"] = template.compare_label(img, await load(template_image), holder_rng)
    return jsonable(out)


@app.post("/label-crop", dependencies=[Depends(auth)])
async def label_crop_ep(image: UploadFile = File(...), geometry: str | None = Form(None)):
    """Normalised label crop used to register a verified template (staff tooling)."""
    _, holder_rng = parse_geometry(geometry)
    lab, _ = template.label_crop(await load(image), holder_rng)
    if lab is None:
        raise HTTPException(422, "label region not found")
    return {"jpeg": base64.b64encode(cv2.imencode(".jpg", lab, [cv2.IMWRITE_JPEG_QUALITY, 95])[1].tobytes()).decode()}
