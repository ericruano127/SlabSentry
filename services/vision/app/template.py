"""Label layout/typography/colour comparison against a VERIFIED label template of the same holder
generation, plus slab proportions. Text content differs between slabs, so we compare the layout
skeleton: positions of logo/text blocks/borders (edge-structure SSIM after alignment), label colour
palette, and holder/label proportions. Without a template everything stays inconclusive."""
from __future__ import annotations
import cv2
import numpy as np
from . import geometry
from .holder import LABEL_FRAC, SLAB_H, SLAB_W

LW, LH = 1000, 300


def _ssim(a: np.ndarray, b: np.ndarray) -> float:
    a, b = a.astype(np.float32), b.astype(np.float32)
    C1, C2 = 6.5, 58.5
    mu_a, mu_b = cv2.GaussianBlur(a, (11, 11), 1.5), cv2.GaussianBlur(b, (11, 11), 1.5)
    sa = cv2.GaussianBlur(a * a, (11, 11), 1.5) - mu_a ** 2
    sb = cv2.GaussianBlur(b * b, (11, 11), 1.5) - mu_b ** 2
    sab = cv2.GaussianBlur(a * b, (11, 11), 1.5) - mu_a * mu_b
    return float((((2 * mu_a * mu_b + C1) * (2 * sab + C2)) / ((mu_a ** 2 + mu_b ** 2 + C1) * (sa + sb + C2))).mean())


def label_crop(img: np.ndarray, holder_rng=geometry._DEFAULT):
    q = geometry.find_slab(img, holder_rng)
    if q is None:
        return None, None
    slab, _ = geometry.warp(img, q.pts, SLAB_W, SLAB_H)
    return cv2.resize(slab[: int(SLAB_H * LABEL_FRAC)], (LW, LH)), q


def proportions(img: np.ndarray, holder_rng=geometry._DEFAULT) -> dict:
    q = geometry.find_slab(img, holder_rng)
    if q is None:
        return {"status": "not_visible"}
    L = [np.linalg.norm(q.pts[(i + 1) % 4] - q.pts[i]) for i in range(4)]
    return {"status": "measured", "holderAspect": round(min((L[0] + L[2]) / (L[1] + L[3]), (L[1] + L[3]) / (L[0] + L[2])), 4), "angleDeviationDeg": round(geometry.corner_angle_deviation(q.pts), 1)}


def compare_label(img: np.ndarray, template: np.ndarray, holder_rng=geometry._DEFAULT) -> dict:
    lab, _ = label_crop(img, holder_rng)
    tpl = cv2.resize(template, (LW, LH))
    if lab is None:
        return {"status": "not_visible", "note": "label region not found"}
    ga, gt = cv2.cvtColor(lab, cv2.COLOR_BGR2GRAY), cv2.cvtColor(tpl, cv2.COLOR_BGR2GRAY)
    # layout skeleton: blurred edge maps (text glyphs differ; block positions, logo, borders shouldn't)
    ea = cv2.GaussianBlur(cv2.Canny(ga, 60, 160), (0, 0), 6)
    et = cv2.GaussianBlur(cv2.Canny(gt, 60, 160), (0, 0), 6)
    layout = _ssim(ea, et)
    # colour palette: compare hue/sat histograms of the label
    ha = cv2.calcHist([cv2.cvtColor(lab, cv2.COLOR_BGR2HSV)], [0, 1], None, [18, 8], [0, 180, 0, 256])
    ht = cv2.calcHist([cv2.cvtColor(tpl, cv2.COLOR_BGR2HSV)], [0, 1], None, [18, 8], [0, 180, 0, 256])
    cv2.normalize(ha, ha); cv2.normalize(ht, ht)
    colour = float(cv2.compareHist(ha, ht, cv2.HISTCMP_CORREL))
    # thresholds: deliberately wide until tuned on labeled data
    layout_status = "consistent" if layout >= 0.55 else "potential_discrepancy" if layout < 0.25 else "inconclusive"
    colour_status = "consistent" if colour >= 0.7 else "potential_discrepancy" if colour < 0.35 else "inconclusive"
    return {"status": "measured", "layout": {"score": round(layout, 3), "status": layout_status}, "colour": {"score": round(colour, 3), "status": colour_status}, "toolVersion": "vision/template@0.1.0"}


def item_hash(img: np.ndarray, item_rng=geometry._DEFAULT) -> dict:
    """Perceptual fingerprint of the ITEM (card/cover) region for cross-upload cert-clone detection."""
    from .hashing import phash, dhash
    q = geometry.find_card(img, item_rng)
    if q is None:
        return {"status": "not_visible"}
    item, _ = geometry.warp(img, q.pts, 500, 700)
    return {"status": "ok", "phash": format(phash(item), "016x"), "dhash": format(dhash(item), "016x")}
