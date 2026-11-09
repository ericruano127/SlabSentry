"""Physical-copy fingerprint signals (Phase 2).

Operates on the upload and reference card both warped into the SAME high-resolution
canonical frame (artwork-aligned). Each signal answers "is this the same physical
copy?" independently and reports its own status, so the rules engine can require
several agreeing signals before claiming an exact physical match.

Signals
  marks         small marks (print specks, dents, scratches) present in one image but
                not the other, after removing shared printed structure; glare-masked.
  edge_profile  micro-shape of the four cut edges (waviness, chips) and corner wear,
                correlated between images. Only informative when the edges carry
                measurable structure above the noise floor.
  registration  inter-channel (R/B vs G) print registration offset. Varies between
                sheets/print runs but is also affected by lens chromatic aberration,
                demosaicing and JPEG chroma subsampling, so thresholds are wide.
Every signal returns "inconclusive" when resolution/coverage is insufficient.
"""
from __future__ import annotations
import cv2
import numpy as np

FP_W, FP_H = 1000, 1400
MIN_CARD_PX = 600  # source card width (px) needed for fine-detail signals

MARK_MIN_CONTRAST = 28.0
MARK_MIN_AREA, MARK_MAX_AREA = 6, 900
MARKS_DISCREPANCY = 4      # distinct unmatched marks needed for a discrepancy
EDGE_CORR_CONSISTENT = 0.6
EDGE_CORR_DISCREPANCY = 0.1
EDGE_MIN_STRUCTURE_PX = 0.9
REG_DISCREPANCY_PX = 2.5
REG_CONSISTENT_PX = 0.8


def _hp(g: np.ndarray, sigma: float) -> np.ndarray:
    g = g.astype(np.float32)
    return g - cv2.GaussianBlur(g, (0, 0), sigma)


def _gain_match(a: np.ndarray, b: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """Match b's tile-wise contrast to a so lighting differences don't look like marks."""
    out = b.copy()
    t = 100
    for y in range(0, a.shape[0], t):
        for x in range(0, a.shape[1], t):
            sl = (slice(y, y + t), slice(x, x + t))
            v = valid[sl] > 0
            if v.sum() < 200:
                continue
            sa, sb = a[sl][v].std(), b[sl][v].std()
            if sb > 1e-3:
                out[sl] = b[sl] * (sa / sb)
    return out


def marks(up: np.ndarray, ref: np.ndarray, valid: np.ndarray) -> dict:
    gu = cv2.cvtColor(up, cv2.COLOR_BGR2GRAY)
    gr = cv2.cvtColor(ref, cv2.COLOR_BGR2GRAY)
    hu, hr = _hp(gu, 3), _hp(gr, 3)
    hu = _gain_match(hr, hu, valid)
    # Small residual misregistration produces thin edge ghosts: suppress where either image has strong edges.
    edges = cv2.dilate(cv2.Canny(gr, 60, 160) | cv2.Canny(gu, 60, 160), np.ones((5, 5), np.uint8))
    m = (valid > 0) & (edges == 0)
    border = np.zeros_like(m)
    border[20:-20, 20:-20] = True
    m &= border
    out = {"onlyInUpload": [], "onlyInReference": []}
    for name, diff in (("onlyInUpload", hu - hr), ("onlyInReference", hr - hu)):
        d = np.abs(cv2.GaussianBlur(diff, (3, 3), 0))
        mask = ((d > MARK_MIN_CONTRAST) & m).astype(np.uint8)
        n, _, stats, cents = cv2.connectedComponentsWithStats(mask, 8)
        for i in range(1, n):
            area = stats[i, cv2.CC_STAT_AREA]
            if MARK_MIN_AREA <= area <= MARK_MAX_AREA:
                x, y, w, h = stats[i, :4]
                out[name].append({"x": x / FP_W, "y": y / FP_H, "w": max(w, 8) / FP_W, "h": max(h, 8) / FP_H, "label": name, "area": int(area)})
    # merge marks closer than 12px (one scratch can split into fragments)
    for k in out:
        merged = []
        for r in sorted(out[k], key=lambda r: -r["area"]):
            if all(abs(r["x"] - q["x"]) * FP_W > 12 or abs(r["y"] - q["y"]) * FP_H > 12 for q in merged):
                merged.append(r)
        out[k] = merged[:25]
    total = len(out["onlyInUpload"]) + len(out["onlyInReference"])
    comparable = float(m.mean())
    status = "inconclusive" if comparable < 0.35 else "potential_discrepancy" if total >= MARKS_DISCREPANCY else "consistent" if total <= 1 else "inconclusive"
    return {"status": status, "unmatched": total, "comparablePct": round(comparable * 100, 1), **out}


def _edge_profiles(card: np.ndarray, band: int = 40) -> np.ndarray | None:
    """Sub-pixel position of the card boundary along each side (in canonical frame).
    Returns concatenated profiles (top, right, bottom, left) minus their linear trend."""
    g = cv2.GaussianBlur(cv2.cvtColor(card, cv2.COLOR_BGR2GRAY).astype(np.float32), (3, 3), 0)
    H, W = g.shape
    profiles = []
    for side in range(4):
        if side == 0:
            strip = g[:band, :]                   # rows = depth into card
        elif side == 2:
            strip = g[H - band:, :][::-1]
        elif side == 1:
            strip = g[:, W - band:][:, ::-1].T
        else:
            strip = g[:, :band].T
        # Depth at which each column first reaches the card's own surface tone. Tracks the
        # physical cut edge (incl. chips/wear) rather than the strongest gradient, which is
        # often the holder well's outline.
        bg = np.median(strip[:2], axis=0)
        surface = np.median(strip[band - 12:band], axis=0)
        contrast = np.abs(surface - bg)
        if np.median(contrast) < 25:
            return None
        reached = np.abs(strip - surface[None, :]) < 0.15 * contrast[None, :]
        idx = np.where(reached.any(0), reached.argmax(0), band).astype(np.float32)
        n = len(idx)
        sl = slice(int(n * 0.08), int(n * 0.92))  # skip corners (rounded/occluded)
        p = idx[sl]
        x = np.arange(len(p))
        p = p - np.polyval(np.polyfit(x, p, 1), x)
        profiles.append(cv2.resize(p.reshape(1, -1), (400, 1), interpolation=cv2.INTER_LINEAR).ravel())
    return np.concatenate(profiles)


def edge_profile(up_card: np.ndarray | None, ref_card: np.ndarray) -> dict:
    if up_card is None:
        return {"status": "inconclusive", "note": "card edges not measurable in your photo"}
    a, b = _edge_profiles(up_card), _edge_profiles(ref_card)
    if a is None or b is None:
        return {"status": "inconclusive", "note": "edges not visible enough"}
    sa, sb = float(a.std()), float(b.std())
    if min(sa, sb) < EDGE_MIN_STRUCTURE_PX:
        return {"status": "inconclusive", "structurePx": round(min(sa, sb), 2), "note": "edges too clean/low resolution to fingerprint"}
    corr = float(np.corrcoef(a, b)[0, 1])
    status = "consistent" if corr >= EDGE_CORR_CONSISTENT else "potential_discrepancy" if corr <= EDGE_CORR_DISCREPANCY else "inconclusive"
    return {"status": status, "correlation": round(corr, 3), "structurePx": round(min(sa, sb), 2)}


def _channel_offset(img: np.ndarray, valid: np.ndarray) -> np.ndarray | None:
    b, g, r = [c.astype(np.float32) for c in cv2.split(img)]
    win = cv2.createHanningWindow(g.shape[::-1], cv2.CV_32F) * (valid > 0).astype(np.float32)
    if win.sum() < 1000:
        return None
    offs = []
    for c in (r, b):
        (dx, dy), resp = cv2.phaseCorrelate(_hp(g, 2), _hp(c, 2), win)
        if resp < 0.05:
            return None
        offs.extend([dx, dy])
    return np.array(offs)


def registration(up: np.ndarray, ref: np.ndarray, valid: np.ndarray) -> dict:
    a, b = _channel_offset(up, valid), _channel_offset(ref, valid)
    if a is None or b is None:
        return {"status": "inconclusive", "note": "not enough colour detail"}
    d = float(np.abs(a - b).max())
    status = "potential_discrepancy" if d >= REG_DISCREPANCY_PX else "consistent" if d <= REG_CONSISTENT_PX else "inconclusive"
    return {"status": status, "deltaPx": round(d, 2), "upload": [round(float(x), 2) for x in a], "reference": [round(float(x), 2) for x in b]}


def fingerprint(upload: np.ndarray, Hfp: np.ndarray, ref_card: np.ndarray, up_card: np.ndarray | None, glare_fn, card_px: dict) -> dict:
    """Hfp maps the upload image into the canonical FP frame of the reference card."""
    up = cv2.warpPerspective(upload, Hfp, (FP_W, FP_H), flags=cv2.INTER_CUBIC)
    cov = cv2.warpPerspective(np.full(upload.shape[:2], 255, np.uint8), Hfp, (FP_W, FP_H))
    glare = cv2.bitwise_or(glare_fn(up), glare_fn(ref_card))
    valid = cv2.erode(cv2.bitwise_and(cov, cv2.bitwise_not(glare)), np.ones((9, 9), np.uint8))
    low_res = min(card_px.values()) < MIN_CARD_PX
    res = {"cardWidthPx": card_px, "lowResolution": low_res}
    if low_res:
        na = {"status": "inconclusive", "note": f"card is only {min(card_px.values())}px wide; {MIN_CARD_PX}px needed for fine detail"}
        res.update(marks=na, edgeProfile=na, registration=na)
    else:
        res["marks"] = marks(up, ref_card, valid)
        res["edgeProfile"] = edge_profile(up_card, ref_card)
        res["registration"] = registration(up, ref_card, valid)
    return res
