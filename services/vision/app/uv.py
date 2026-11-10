"""UV (blacklight) capture analysis. A phone camera under a 365–395 nm blacklight sees visible
fluorescence. We measure WHERE fluorescence appears and, when a verified template exists for the
holder generation, compare the pattern. Without a template the result stays inconclusive: absence
of glow can be the light, the camera, or an older label."""
from __future__ import annotations
import cv2
import numpy as np
from .versions import TOOL_VERSIONS


def fluorescence_map(img: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    v = hsv[..., 2].astype(np.float32)
    # glow = bright relative to the (dark, violet-cast) scene, excluding the lamp's violet reflection
    bg = cv2.GaussianBlur(v, (0, 0), 25)
    hue = hsv[..., 0]
    violet = (hue > 125) & (hue < 160)
    return (((v - bg) > 25) & (v > 90) & ~violet).astype(np.uint8)


def analyze(uv: np.ndarray, template: np.ndarray | None = None) -> dict:
    m = fluorescence_map(uv)
    frac = float(m.mean())
    hsv = cv2.cvtColor(uv, cv2.COLOR_BGR2HSV)
    scene_violet = float(((hsv[..., 0] > 125) & (hsv[..., 0] < 160) & (hsv[..., 1] > 60)).mean())
    out = {"fluorescentPct": round(frac * 100, 2), "uvLightLikely": scene_violet > 0.15, "toolVersion": TOOL_VERSIONS["uv"]}
    if not out["uvLightLikely"]:
        return {**out, "status": "not_visible", "note": "photo doesn't look like it was taken under a blacklight"}
    if template is None:
        return {**out, "status": "inconclusive", "note": "fluorescence observed" if frac > 0.002 else "no fluorescence observed", "templateCompared": False}
    t = fluorescence_map(cv2.resize(template, (uv.shape[1], uv.shape[0])))
    inter = float((m & t).sum())
    union = float((m | t).sum()) + 1e-6
    iou = inter / union
    status = "consistent" if iou >= 0.35 else "potential_discrepancy" if iou < 0.1 and t.mean() > 0.002 else "inconclusive"
    return {**out, "status": status, "templateCompared": True, "patternIoU": round(iou, 3)}
