"""Holder edge / seam close-up review (visible light only).

Finds the dominant straight structure (holder edge or weld seam) in an edge close-up
and scans along it for localized anomalies: gaps, cracks, bulges, residue. Results are
conservative — anomalies are "inconclusive, review highlighted area", never a verdict:
scratches, dust and reflections look similar.
"""
from __future__ import annotations
import cv2
import numpy as np

ANOMALY_Z = 4.5


def review_edge(img: np.ndarray) -> dict:
    s = 1200 / max(img.shape[:2])
    if s < 1:
        img = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    g = cv2.GaussianBlur(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), (3, 3), 0)
    e = cv2.Canny(g, 50, 150)
    lines = cv2.HoughLinesP(e, 1, np.pi / 360, threshold=120, minLineLength=int(0.4 * max(g.shape)), maxLineGap=12)
    if lines is None:
        return {"status": "not_visible", "note": "no clear holder edge or seam found"}
    x1, y1, x2, y2 = (float(v) for v in max(lines.reshape(-1, 4), key=lambda l: np.hypot(l[2] - l[0], l[3] - l[1])))
    L = float(np.hypot(x2 - x1, y2 - y1))
    ux, uy = (x2 - x1) / L, (y2 - y1) / L
    nx, ny = -uy, ux
    # sample a band perpendicular to the line: rows = along-line, cols = across
    ts = np.arange(0, L, 2.0)
    offs = np.arange(-10, 11, 1.0)
    X = (x1 + ts[:, None] * ux + offs[None, :] * nx).astype(np.float32)
    Y = (y1 + ts[:, None] * uy + offs[None, :] * ny).astype(np.float32)
    band = cv2.remap(g.astype(np.float32), X, Y, cv2.INTER_LINEAR)
    prof = band.mean(1) - cv2.GaussianBlur(band.mean(1).reshape(-1, 1), (1, 0), 15).ravel()
    edge_pos = np.abs(np.diff(band, axis=1)).argmax(1).astype(np.float32)
    feats = np.stack([prof, edge_pos - np.median(edge_pos)], 1)
    med = np.median(feats, 0)
    mad = np.median(np.abs(feats - med), 0) * 1.4826 + 1e-3
    z = np.abs((feats - med) / mad).max(1)
    hits = np.where(z > ANOMALY_Z)[0]
    regions = []
    H, W = g.shape
    for grp in np.split(hits, np.where(np.diff(hits) > 3)[0] + 1) if len(hits) else []:
        if len(grp) < 2:
            continue
        t = ts[grp].mean()
        cx, cy = x1 + t * ux, y1 + t * uy
        regions.append({"x": max(0, cx - 25) / W, "y": max(0, cy - 25) / H, "w": 50 / W, "h": 50 / H, "label": "edge anomaly"})
    straight = float(np.std(edge_pos))
    status = "inconclusive" if regions else "consistent"
    return {"status": status, "anomalies": len(regions), "regions": regions[:10], "edgeJitterPx": round(straight, 2), "lineLengthPx": round(L)}
