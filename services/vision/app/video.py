"""Guided tilt-video → representative frames.

Samples the clip, scores sharpness, drops near-duplicates (pHash) so a static video
can't masquerade as many independent observations, and returns frames spread across
the tilt. It does NOT prove liveness or that a security element is genuine.
"""
from __future__ import annotations
import os
import tempfile
import cv2
import numpy as np
from .hashing import hamming, phash

MAX_SECONDS = 15
MAX_SAMPLES = 48
DUP_HAMMING = 3


def extract_frames(data: bytes, k: int = 6) -> dict:
    fd, path = tempfile.mkstemp(suffix=".mp4")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        cap = cv2.VideoCapture(path)
        if not cap.isOpened():
            raise ValueError("unsupported or corrupt video")
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        if not (0 < fps < 240):
            fps = 30
        n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        cands = []

        def add(i, fr):
            s = 1000 / max(fr.shape[:2])
            g = cv2.cvtColor(cv2.resize(fr, None, fx=min(1, s), fy=min(1, s)), cv2.COLOR_BGR2GRAY)
            cands.append({"i": int(i), "t": round(i / fps, 2), "frame": fr, "sharp": float(cv2.Laplacian(g, cv2.CV_64F).var()), "hash": phash(fr)})

        limit = int(MAX_SECONDS * fps)
        if n > 0:
            for i in np.linspace(0, min(n, limit) - 1, num=min(MAX_SAMPLES, n)).astype(int):
                cap.set(cv2.CAP_PROP_POS_FRAMES, int(i))
                ok, fr = cap.read()
                if ok:
                    add(i, fr)
        if not cands:
            # Browser-recorded WebM often has no frame count / seek index: decode sequentially.
            cap.release()
            cap = cv2.VideoCapture(path)
            frames = []
            while len(frames) < limit:
                ok, fr = cap.read()
                if not ok:
                    break
                frames.append(fr)
            n = len(frames)
            for i in np.linspace(0, n - 1, num=min(MAX_SAMPLES, n)).astype(int) if n else []:
                add(i, frames[i])
        duration = n / fps
        cap.release()
    finally:
        os.unlink(path)
    if not cands:
        raise ValueError("could not decode video frames")
    med = float(np.median([c["sharp"] for c in cands]))
    usable = [c for c in cands if c["sharp"] >= 0.5 * med]
    # split timeline into k buckets, take the sharpest distinct frame from each
    chosen: list[dict] = []
    for bucket in np.array_split(np.array(usable, dtype=object), k):
        for c in sorted(bucket, key=lambda c: -c["sharp"]):
            if all(hamming(c["hash"], o["hash"]) > DUP_HAMMING for o in chosen):
                chosen.append(c)
                break
    frames = [{"t": c["t"], "sharpness": round(c["sharp"], 1), "jpeg": cv2.imencode(".jpg", c["frame"], [cv2.IMWRITE_JPEG_QUALITY, 92])[1].tobytes()} for c in chosen]
    return {"durationSec": round(duration, 2), "sampled": len(cands), "distinctFrames": len(frames), "frames": frames,
            "status": "ok" if len(frames) >= 3 else "too_few_distinct_frames"}
