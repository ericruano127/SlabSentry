"""Microprint close-ups: can fine print be resolved at all (camera/focus limit), and — if a verified
template crop exists — does the fine structure match it?"""
from __future__ import annotations
import cv2
import numpy as np


def resolvability(img: np.ndarray) -> dict:
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    s = 1200 / max(g.shape)
    if s < 1:
        g = cv2.resize(g, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    f = np.abs(np.fft.fftshift(np.fft.fft2(g - g.mean()))) ** 2  # power spectrum
    h, w = f.shape
    yy, xx = np.ogrid[:h, :w]
    r = np.sqrt((yy - h / 2) ** 2 + (xx - w / 2) ** 2) / (min(h, w) / 2)
    hi = float(f[(r > 0.35) & (r < 0.9)].sum() / (f[(r > 0.02)].sum() + 1e-6))
    return {"highFrequencyRatio": round(hi, 4), "resolvable": hi > 0.08}


def analyze(img: np.ndarray, template: np.ndarray | None = None) -> dict:
    res = resolvability(img)
    out = {**res, "toolVersion": "vision/microprint@0.1.0"}
    if not res["resolvable"]:
        return {**out, "status": "not_supported_by_device", "note": "fine print isn't resolved in this close-up (focus or camera limit)"}
    if template is None:
        return {**out, "status": "inconclusive", "templateCompared": False, "note": "fine print resolved; no verified template to compare"}
    sift = cv2.SIFT_create(3000)
    g1, g2 = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), cv2.cvtColor(template, cv2.COLOR_BGR2GRAY)
    k1, d1 = sift.detectAndCompute(g1, None)
    k2, d2 = sift.detectAndCompute(g2, None)
    if d1 is None or d2 is None or len(k1) < 20 or len(k2) < 20:
        return {**out, "status": "inconclusive", "templateCompared": True, "note": "too little structure to compare"}
    good = [m for m, n in (p for p in cv2.BFMatcher().knnMatch(d1, d2, k=2) if len(p) == 2) if m.distance < 0.75 * n.distance]
    inl = 0
    if len(good) >= 8:
        H, mask = cv2.findHomography(np.float32([k1[m.queryIdx].pt for m in good]), np.float32([k2[m.trainIdx].pt for m in good]), cv2.RANSAC, 4.0)
        inl = int(mask.sum()) if mask is not None else 0
    status = "consistent" if inl >= 25 else "potential_discrepancy" if inl < 8 and len(k1) > 200 else "inconclusive"
    return {**out, "status": status, "templateCompared": True, "inliers": inl}
