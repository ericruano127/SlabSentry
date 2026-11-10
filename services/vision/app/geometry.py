"""Slab / card boundary detection and perspective normalization."""
from dataclasses import dataclass
import cv2
import numpy as np

CARD_ASPECT = 2.5 / 3.5  # standard trading card short/long ~0.714
SLAB_ASPECT_RANGE = (0.52, 0.68)
CARD_ASPECT_RANGE = (0.66, 0.77)


@dataclass
class Quad:
    pts: np.ndarray  # 4x2 float32 ordered tl, tr, br, bl
    contour: np.ndarray
    area_frac: float
    aspect: float  # short/long

    def touches_border(self, shape, margin_frac=0.01):
        h, w = shape[:2]
        m = margin_frac * max(h, w)
        x, y = self.pts[:, 0], self.pts[:, 1]
        return {
            "left": bool(x.min() <= m),
            "right": bool(x.max() >= w - 1 - m),
            "top": bool(y.min() <= m),
            "bottom": bool(y.max() >= h - 1 - m),
        }


def order(pts: np.ndarray) -> np.ndarray:
    pts = pts.reshape(4, 2).astype(np.float32)
    s, d = pts.sum(1), np.diff(pts, axis=1).ravel()
    return np.array([pts[s.argmin()], pts[d.argmin()], pts[s.argmax()], pts[d.argmax()]], np.float32)


def _side_lengths(p):
    return [np.linalg.norm(p[(i + 1) % 4] - p[i]) for i in range(4)]


def find_quads(img: np.ndarray, min_area_frac=0.05) -> list[Quad]:
    g = cv2.GaussianBlur(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), (5, 5), 0)
    h, w = g.shape
    out: list[Quad] = []
    for lo, hi in ((30, 100), (60, 180)):
        e = cv2.dilate(cv2.Canny(g, lo, hi), np.ones((3, 3), np.uint8))
        cnts, _ = cv2.findContours(e, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
        for c in cnts:
            a = cv2.contourArea(c)
            if a < min_area_frac * h * w:
                continue
            peri = cv2.arcLength(c, True)
            ap = cv2.approxPolyDP(c, 0.02 * peri, True)
            if len(ap) != 4 or not cv2.isContourConvex(ap):
                continue
            p = order(ap)
            L = _side_lengths(p)
            aspect = ((L[0] + L[2]) / 2) / ((L[1] + L[3]) / 2)
            aspect = min(aspect, 1 / aspect)
            out.append(Quad(p, c, a / (h * w), float(aspect)))
    # de-duplicate near-identical quads
    uniq: list[Quad] = []
    for q in sorted(out, key=lambda q: -q.area_frac):
        if all(np.abs(q.pts - u.pts).max() > 0.01 * max(h, w) for u in uniq):
            uniq.append(q)
    return uniq


_DEFAULT = object()


def _shape_ok(q: "Quad", rng) -> bool:
    return rng is None or rng[0] <= q.aspect <= rng[1]


def find_slab(img, aspect_range=_DEFAULT) -> Quad | None:
    """Largest holder-shaped quad. aspect_range None = any shape (categories without a known holder shape)."""
    rng = SLAB_ASPECT_RANGE if aspect_range is _DEFAULT else aspect_range
    qs = [q for q in find_quads(img, 0.15) if _shape_ok(q, rng)]
    return qs[0] if qs else None


def find_card(img, aspect_range=_DEFAULT) -> Quad | None:
    """Largest item-shaped quad inside a holder (or a raw item image). None = any shape; for unknown
    shapes the outer holder quad is skipped when a smaller nested quad exists."""
    rng = CARD_ASPECT_RANGE if aspect_range is _DEFAULT else aspect_range
    qs = [q for q in find_quads(img, 0.08) if _shape_ok(q, rng)]
    if rng is None and len(qs) > 1:
        return qs[1]  # largest is usually the holder itself; the next is the item window
    return qs[0] if qs else None


def parse_geometry(raw: str | None):
    """Request field → (item_range, holder_range). Missing field keeps card defaults."""
    if not raw:
        return _DEFAULT, _DEFAULT
    import json
    g = json.loads(raw)
    conv = lambda v: tuple(v) if v else None
    return conv(g.get("itemAspect")), conv(g.get("holderAspect"))


def warp(img, quad_pts, out_w: int, out_h: int):
    dst = np.array([[0, 0], [out_w - 1, 0], [out_w - 1, out_h - 1], [0, out_h - 1]], np.float32)
    M = cv2.getPerspectiveTransform(quad_pts.astype(np.float32), dst)
    return cv2.warpPerspective(img, M, (out_w, out_h), flags=cv2.INTER_CUBIC), M


def corner_angle_deviation(p: np.ndarray) -> float:
    """Max deviation (deg) of quad corner angles from 90 — proxy for camera tilt."""
    dev = 0.0
    for i in range(4):
        a, b, c = p[i - 1], p[i], p[(i + 1) % 4]
        v1, v2 = a - b, c - b
        cos = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-9)
        dev = max(dev, abs(np.degrees(np.arccos(np.clip(cos, -1, 1))) - 90))
    return float(dev)


def edge_straightness(q: Quad) -> float:
    """95th percentile distance of contour points from their nearest quad side, % of side length."""
    pts = q.contour.reshape(-1, 2).astype(np.float32)
    P = q.pts
    worst = 0.0
    for i in range(4):
        a, b = P[i], P[(i + 1) % 4]
        ab = b - a
        L = np.linalg.norm(ab) + 1e-9
        t = ((pts - a) @ ab) / (L * L)
        sel = pts[(t > 0.1) & (t < 0.9)]
        if len(sel) == 0:
            continue
        rel = sel - a
        d = np.abs(ab[0] * rel[:, 1] - ab[1] * rel[:, 0]) / L
        near = d[d < 0.08 * L]  # points belonging to this side
        if len(near) > 20:
            worst = max(worst, float(np.percentile(near, 95) / L * 100))
    return worst
