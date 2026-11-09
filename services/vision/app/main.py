import os
import time
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
import base64
from . import compare as cmp, holder, ocr, quality, seam, video
from .codes import decode_codes
from .imaging import decode, limit

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
async def quality_ep(image: UploadFile = File(...), role: str = Form("front")):
    t = time.perf_counter()
    r = quality.assess(await load(image), role)
    r["elapsedMs"] = round((time.perf_counter() - t) * 1000)
    return r


@app.post("/extract", dependencies=[Depends(auth)])
async def extract_ep(image: UploadFile = File(...)):
    img = await load(image)
    return {"codes": decode_codes(img), "ocr": ocr.read_text(img)}


@app.post("/compare", dependencies=[Depends(auth)])
async def compare_ep(upload: UploadFile = File(...), reference: UploadFile = File(...), upload_label_text: str | None = Form(None)):
    t = time.perf_counter()
    r = cmp.compare(await load(upload), await load(reference), upload_label_text.split("\n") if upload_label_text else None)
    r["elapsedMs"] = round((time.perf_counter() - t) * 1000)
    return r


@app.post("/holder", dependencies=[Depends(auth)])
async def holder_ep(
    front: UploadFile = File(...),
    label: UploadFile | None = File(None),
    tilt: list[UploadFile] | None = File(None),
    normal: UploadFile | None = File(None),
    backlit: UploadFile | None = File(None),
):
    t = time.perf_counter()
    frames = [await load(f) for f in (tilt or [])][:12]
    pair = (await load(normal), await load(backlit)) if normal and backlit else None
    r = holder.inspect(await load(front), await load(label) if label else None, frames, pair)
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
