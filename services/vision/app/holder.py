"""Holder Security Inspection Engine (visible-light, photo-based).

Produces measurements only for what a phone camera can observe: holder edges
and straightness, label region, machine-readable codes, OCR text, variation
across tilt frames (holographic elements) and normal-vs-backlit change. It never
claims to verify UV features or that a scan is live.
"""
from __future__ import annotations
import cv2
import numpy as np
from . import geometry, ocr
from .codes import decode_codes

TOOL_VERSION = "vision/holder@0.1.0"
SLAB_W, SLAB_H = 620, 1000
LABEL_FRAC = 0.22  # label occupies the top ~22% of a canonical upright slab (approximation)

EDGE_DEV_CONSISTENT = 1.2
EDGE_DEV_DISCREPANCY = 3.0
TILT_HOLO_FRAC = 0.01
BACKLIT_DELTA = 18.0


def _label_crop(img, rng=geometry._DEFAULT):
    q = geometry.find_slab(img, rng)
    if q is None:
        return None, None
    slab, _ = geometry.warp(img, q.pts, SLAB_W, SLAB_H)
    return slab[: int(SLAB_H * LABEL_FRAC)], q


def inspect(front: np.ndarray, label_closeup: np.ndarray | None = None, tilt_frames: list[np.ndarray] | None = None,
            backlit_pair: tuple[np.ndarray, np.ndarray] | None = None, holder_rng=geometry._DEFAULT) -> dict:
    out: dict = {"toolVersion": TOOL_VERSION, "codes": [], "ocrText": [], "ocrAvailable": ocr.available()}
    q = geometry.find_slab(front, holder_rng)
    out["slabDetected"] = q is not None
    if q is not None:
        touch = q.touches_border(front.shape)
        out["edgesVisible"] = {k: not v for k, v in touch.items()}
        dev = geometry.edge_straightness(q)
        status = "consistent" if dev <= EDGE_DEV_CONSISTENT else "potential_discrepancy" if dev >= EDGE_DEV_DISCREPANCY else "inconclusive"
        if geometry.corner_angle_deviation(q.pts) > 10:
            status = "inconclusive" if status == "potential_discrepancy" else status  # perspective can bend apparent edges
        out["edgeStraightness"] = {"maxDeviationPct": round(dev, 2), "status": status}
        h, w = front.shape[:2]
        x0, y0 = q.pts.min(0)
        x1, y1 = q.pts.max(0)
        out["labelRegion"] = {"x": float(x0 / w), "y": float(y0 / h), "w": float((x1 - x0) / w), "h": float((y1 - y0) / h * LABEL_FRAC), "label": "label (approx.)"}
    else:
        out["edgesVisible"] = {"top": False, "bottom": False, "left": False, "right": False}
        out["edgeStraightness"] = {"maxDeviationPct": 0.0, "status": "not_visible"}

    sources = [s for s in (label_closeup, _label_crop(front, holder_rng)[0], front) if s is not None]
    codes: dict[str, str] = {}
    for s in sources:
        for c in decode_codes(s):
            codes.setdefault(c["data"], c["type"])
        if codes:
            break
    out["codes"] = [{"type": t, "data": d} for d, t in codes.items()]

    text_src = label_closeup if label_closeup is not None else (_label_crop(front, holder_rng)[0] if q is not None else front)
    out["ocrText"] = [r["text"] for r in ocr.read_text(text_src)] if text_src is not None else []

    if tilt_frames and len(tilt_frames) >= 2:
        out["tilt"] = tilt_variation(tilt_frames)
    if backlit_pair:
        out["backlit"] = backlit_change(*backlit_pair)
    return out


def _align_to(base_g, img):
    orb = cv2.ORB_create(3000)
    k1, d1 = orb.detectAndCompute(base_g, None)
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    k2, d2 = orb.detectAndCompute(g, None)
    if d1 is None or d2 is None:
        return None
    m = sorted(cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True).match(d2, d1), key=lambda x: x.distance)[:500]
    if len(m) < 15:
        return None
    H, inl = cv2.findHomography(np.float32([k2[x.queryIdx].pt for x in m]), np.float32([k1[x.trainIdx].pt for x in m]), cv2.RANSAC, 4.0)
    if H is None or inl.sum() < 12:
        return None
    return cv2.warpPerspective(img, H, (base_g.shape[1], base_g.shape[0]))


def tilt_variation(frames: list[np.ndarray]) -> dict:
    base = cv2.resize(frames[0], (800, int(800 * frames[0].shape[0] / frames[0].shape[1])))
    bg = cv2.cvtColor(base, cv2.COLOR_BGR2GRAY)
    aligned = [base]
    for f in frames[1:]:
        f = cv2.resize(f, (base.shape[1], base.shape[0]))
        a = _align_to(bg, f)
        if a is not None:
            aligned.append(a)
    if len(aligned) < 2:
        return {"frames": len(frames), "hueVariation": 0.0, "brightnessVariation": 0.0, "status": "inconclusive", "note": "frames could not be aligned"}
    hsv = np.stack([cv2.cvtColor(a, cv2.COLOR_BGR2HSV).astype(np.float32) for a in aligned])
    hue = hsv[..., 0] * 2 * np.pi / 180
    sat_ok = (hsv[..., 1] > 60).all(0) & (hsv[..., 2] > 50).all(0) & (hsv[..., 2] < 245).all(0)
    # circular std of hue per pixel
    R = np.sqrt(np.cos(hue).mean(0) ** 2 + np.sin(hue).mean(0) ** 2)
    circ_std = np.degrees(np.sqrt(-2 * np.log(np.clip(R, 1e-6, 1))))
    holo = sat_ok & (circ_std > 25)
    frac = float(holo.mean())
    bvar = float(hsv[..., 2].std(0).mean())
    return {
        "frames": len(aligned),
        "hueVariation": round(frac * 100, 2),  # % of area with strong angle-dependent hue change
        "brightnessVariation": round(bvar, 2),
        # Only "consistent" or "inconclusive": absence of change can be lighting/technique.
        "status": "consistent" if frac >= TILT_HOLO_FRAC else "inconclusive",
    }


def backlit_change(normal: np.ndarray, backlit: np.ndarray) -> dict:
    base = cv2.resize(normal, (800, int(800 * normal.shape[0] / normal.shape[1])))
    bg = cv2.cvtColor(base, cv2.COLOR_BGR2GRAY)
    b = cv2.resize(backlit, (base.shape[1], base.shape[0]))
    a = _align_to(bg, b)
    if a is None:
        return {"status": "inconclusive", "luminanceDelta": 0.0, "note": "could not align"}
    d = cv2.absdiff(cv2.cvtColor(a, cv2.COLOR_BGR2GRAY), bg).astype(np.float32)
    # localized change: 99th percentile minus median removes global exposure shift
    delta = float(np.percentile(d, 99) - np.median(d))
    return {"status": "consistent" if delta >= BACKLIT_DELTA else "inconclusive", "luminanceDelta": round(delta, 1)}
