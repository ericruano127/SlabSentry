"""Reference Image Comparison Engine.

Stages
 1. Card localization (card quad inside slab or raw-card reference).
 2. Normalization: CLAHE, perspective warp of each card to a canonical frame.
 3. Artwork alignment with SIFT + RANSAC homography restricted to the card area.
 4. Physical-copy fingerprint:
    a. card-edge offset relative to aligned artwork (cut / centering differs
       between copies of the same design; robust to lighting),
    b. border centering ratios,
    c. local structural residuals (high-pass NCC per cell) with glare masking.
 5. Photo-reuse detection with perceptual hashes.
All outputs are measurements + conservative statuses; the rules engine decides
what they mean. Originals are never modified.
"""
from __future__ import annotations
import cv2
import numpy as np
from . import fingerprint as fp, geometry, label
from .hashing import phash, hamming
from .imaging import glare_mask, to_png_b64

TOOL_VERSION = "vision/compare@0.2.0"
CANON_W, CANON_H = 500, 700
GRID = (6, 8)  # cols, rows

# Thresholds (documented; tune on the labeled dataset — see docs/TESTING.md)
DESIGN_MIN_INLIERS = 25
DESIGN_MIN_RATIO = 0.12
DESIGN_FAIL_INLIERS = 10
DESIGN_FAIL_RATIO = 0.04  # shared set layout/text can give a few dozen inliers between different cards
EDGE_OFFSET_DISCREPANCY_PCT = 2.0
EDGE_OFFSET_CONSISTENT_PCT = 1.0
CELL_NCC_FLAG = 0.35
PHOTO_REUSE_HAMMING = 6


def _clahe(g):
    return cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(g)


def _card_or_none(img, rng=geometry._DEFAULT):
    return geometry.find_card(img, rng)


def _mask_from_quad(shape, pts, shrink=0.04):
    c = pts.mean(0)
    p = (c + (pts - c) * (1 - shrink)).astype(np.int32)
    m = np.zeros(shape[:2], np.uint8)
    cv2.fillConvexPoly(m, p, 255)
    return m


def _align(up, ref, up_mask, ref_mask):
    sift = cv2.SIFT_create(nfeatures=4000)
    gu, gr = _clahe(cv2.cvtColor(up, cv2.COLOR_BGR2GRAY)), _clahe(cv2.cvtColor(ref, cv2.COLOR_BGR2GRAY))
    ku, du = sift.detectAndCompute(gu, up_mask)
    kr, dr = sift.detectAndCompute(gr, ref_mask)
    info = {"kpUpload": len(ku), "kpReference": len(kr), "inliers": 0, "inlierRatio": 0.0}
    if du is None or dr is None or len(ku) < 8 or len(kr) < 8:
        return None, info
    matches = cv2.FlannBasedMatcher({"algorithm": 1, "trees": 5}, {"checks": 64}).knnMatch(du, dr, k=2)
    good = [m for m, n in (p for p in matches if len(p) == 2) if m.distance < 0.75 * n.distance]
    info["goodMatches"] = len(good)
    if len(good) < 8:
        return None, info
    src = np.float32([ku[m.queryIdx].pt for m in good])
    dst = np.float32([kr[m.trainIdx].pt for m in good])
    H, inl = cv2.findHomography(src, dst, cv2.USAC_MAGSAC, 3.0, maxIters=5000, confidence=0.999)
    if H is None:
        return None, info
    n = int(inl.sum())
    info["inliers"] = n
    info["inlierRatio"] = n / max(1, min(len(ku), len(kr)))
    # reject degenerate homographies (extreme scale/shear)
    det = np.linalg.det(H[:2, :2])
    if not (0.05 < abs(det) < 20):
        return None, info
    return H, info


def _border_ratios(card_bgr):
    """Centering from the artwork frame inside the canonical card: L/R and T/B ratios (0.5 = perfect)."""
    g = cv2.GaussianBlur(cv2.cvtColor(card_bgr, cv2.COLOR_BGR2GRAY), (3, 3), 0)
    e = cv2.Canny(g, 40, 120)
    h, w = e.shape
    colp = e[int(h * 0.2): int(h * 0.8)].mean(0)
    rowp = e[:, int(w * 0.2): int(w * 0.8)].mean(1)

    def first_peak(p, lo, hi):
        seg = p[lo:hi]
        if seg.max() < 20:
            return None
        return lo + int(np.argmax(seg > seg.max() * 0.6))

    m = 0.015
    L = first_peak(colp, int(w * m), int(w * 0.25))
    R = first_peak(colp[::-1], int(w * m), int(w * 0.25))
    T = first_peak(rowp, int(h * m), int(h * 0.25))
    B = first_peak(rowp[::-1], int(h * m), int(h * 0.25))
    if None in (L, R, T, B):
        return None
    return {"lr": round(L / (L + R), 3), "tb": round(T / (T + B), 3)}


def _local_differences(a_bgr, b_bgr, valid):
    ga = cv2.cvtColor(a_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    gb = cv2.cvtColor(b_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    ha = ga - cv2.GaussianBlur(ga, (0, 0), 3)
    hb = gb - cv2.GaussianBlur(gb, (0, 0), 3)
    h, w = ga.shape
    cols, rows = GRID
    cw, ch = w // cols, h // rows
    scores = np.full((rows, cols), np.nan, np.float32)
    flagged = []
    for r in range(rows):
        for c in range(cols):
            sl = (slice(r * ch, (r + 1) * ch), slice(c * cw, (c + 1) * cw))
            v = valid[sl] > 0
            if v.mean() < 0.7:
                continue
            x, y = ha[sl][v], hb[sl][v]
            if x.std() < 2 or y.std() < 2:  # flat region; nothing to compare
                scores[r, c] = 1.0
                continue
            ncc = float(np.corrcoef(x, y)[0, 1])
            scores[r, c] = ncc
            if ncc < CELL_NCC_FLAG:
                flagged.append({"x": c / cols, "y": r / rows, "w": 1 / cols, "h": 1 / rows, "label": f"ncc={ncc:.2f}"})
    comparable = float(np.isfinite(scores).mean())
    return scores, flagged, comparable


def compare(upload: np.ndarray, reference: np.ndarray, upload_label_text: list[str] | None = None, item_rng=geometry._DEFAULT, holder_rng=geometry._DEFAULT) -> dict:
    out = {
        "toolVersion": TOOL_VERSION,
        "designMatch": {"status": "inconclusive", "inliers": 0, "inlierRatio": 0.0},
        "photoReuse": {},
        "centering": {"status": "inconclusive"},
        "localDifferences": {"status": "inconclusive", "flaggedRegions": [], "glareMaskedPct": 0.0, "comparableAreaPct": 0.0},
        "overlays": {},
        "diagnostics": {},
    }
    hf = hamming(phash(upload), phash(reference))
    qu, qr = _card_or_none(upload, item_rng), _card_or_none(reference, item_rng)
    out["diagnostics"]["cardDetected"] = {"upload": qu is not None, "reference": qr is not None}

    mu = _mask_from_quad(upload.shape, qu.pts) if qu is not None else None
    mr = _mask_from_quad(reference.shape, qr.pts) if qr is not None else None
    H, info = _align(upload, reference, mu, mr)
    out["diagnostics"]["alignment"] = info
    dm = out["designMatch"]
    dm["inliers"], dm["inlierRatio"] = info["inliers"], round(info["inlierRatio"], 3)
    enough_texture = info["kpUpload"] >= 150 and info["kpReference"] >= 150
    if H is not None and info["inliers"] >= DESIGN_MIN_INLIERS and info["inlierRatio"] >= DESIGN_MIN_RATIO:
        dm["status"] = "consistent"
    elif enough_texture and (info["inliers"] < DESIGN_FAIL_INLIERS or info["inlierRatio"] < DESIGN_FAIL_RATIO):
        dm["status"] = "potential_discrepancy"

    # Card-region hash (if cards found)
    hc = hf
    if qu is not None and qr is not None:
        cu, _ = geometry.warp(upload, qu.pts, CANON_W, CANON_H)
        cr, _ = geometry.warp(reference, qr.pts, CANON_W, CANON_H)
        hc = hamming(phash(cu), phash(cr))
    out["photoReuse"] = {"hammingFull": hf, "hammingCard": hc, "nearIdentical": hf <= PHOTO_REUSE_HAMMING}

    out["labelComparison"] = label.compare_labels(upload, reference, upload_label_text, holder_rng)
    if dm["status"] != "consistent" or qr is None:
        return out

    # Canonical reference frame for the card.
    ref_card, Mref = geometry.warp(reference, qr.pts, CANON_W, CANON_H)
    Hc = Mref @ H  # upload -> canonical reference card
    up_in_ref = cv2.warpPerspective(upload, Hc, (CANON_W, CANON_H), flags=cv2.INTER_CUBIC)
    coverage = cv2.warpPerspective(np.full(upload.shape[:2], 255, np.uint8), Hc, (CANON_W, CANON_H))

    # 4a. edge offset: where does the upload's own card boundary land in the reference frame?
    cent = out["centering"]
    if qu is not None:
        up_corners = cv2.perspectiveTransform(qu.pts.reshape(-1, 1, 2), Hc).reshape(4, 2)
        canon = np.array([[0, 0], [CANON_W - 1, 0], [CANON_W - 1, CANON_H - 1], [0, CANON_H - 1]], np.float32)
        disp = np.abs(up_corners - canon)
        off = float(disp.max() / CANON_W * 100)
        cent["edgeOffsetPct"] = round(off, 2)
        cent["status"] = "potential_discrepancy" if off >= EDGE_OFFSET_DISCREPANCY_PCT else "consistent" if off <= EDGE_OFFSET_CONSISTENT_PCT else "inconclusive"
        up_card, _ = geometry.warp(upload, qu.pts, CANON_W, CANON_H)
        cent["upload"] = _border_ratios(up_card)
        cent["reference"] = _border_ratios(ref_card)

    # 4c. local structural differences
    glare = cv2.bitwise_or(glare_mask(up_in_ref), glare_mask(ref_card))
    valid = cv2.bitwise_and(coverage, cv2.bitwise_not(glare))
    valid = cv2.erode(valid, np.ones((7, 7), np.uint8))
    scores, flagged, comparable = _local_differences(up_in_ref, ref_card, valid)
    ld = out["localDifferences"]
    ld["glareMaskedPct"] = round(float((glare > 0).mean() * 100), 1)
    ld["comparableAreaPct"] = round(comparable * 100, 1)
    ld["flaggedRegions"] = flagged
    if comparable < 0.5:
        ld["status"] = "inconclusive"
    elif len(flagged) >= 2:
        ld["status"] = "potential_discrepancy"
    elif len(flagged) == 1:
        ld["status"] = "inconclusive"
    else:
        ld["status"] = "consistent"

    # Phase 2: physical-copy fingerprint at higher resolution (artwork-aligned frame).
    side = lambda q: int(round(float(np.linalg.norm(q.pts[1] - q.pts[0]))))
    card_px = {"upload": side(qu) if qu is not None else 0, "reference": side(qr)}
    ref_fp, Mfp = geometry.warp(reference, qr.pts, fp.FP_W, fp.FP_H)
    up_fp_own = geometry.warp(upload, qu.pts, fp.FP_W, fp.FP_H)[0] if qu is not None else None
    out["fingerprint"] = fp.fingerprint(upload, Mfp @ H, ref_fp, up_fp_own, glare_mask, card_px)
    mk = out["fingerprint"].get("marks", {})
    out["overlays"] = _overlays(up_in_ref, ref_card, scores, flagged, mk.get("onlyInUpload", []) + mk.get("onlyInReference", []))
    return out


def _overlays(up, ref, scores, flagged, marks=()):
    side = np.hstack([up, np.full((CANON_H, 12, 3), 255, np.uint8), ref])
    for m in marks:  # unique marks: magenta circles on the image where they appear
        dx = 0 if m["label"] == "onlyInUpload" else CANON_W + 12
        cx, cy = int((m["x"] + m["w"] / 2) * CANON_W) + dx, int((m["y"] + m["h"] / 2) * CANON_H)
        cv2.circle(side, (cx, cy), 12, (255, 0, 255), 2)
    for f in flagged:
        for dx in (0, CANON_W + 12):
            x, y = int(f["x"] * CANON_W) + dx, int(f["y"] * CANON_H)
            cv2.rectangle(side, (x, y), (x + int(f["w"] * CANON_W), y + int(f["h"] * CANON_H)), (0, 0, 255), 2)
    cv2.putText(side, "YOUR PHOTO (aligned)", (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
    cv2.putText(side, "REFERENCE", (CANON_W + 20, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
    s = np.nan_to_num(scores, nan=1.0)
    heat = cv2.resize(((1 - np.clip(s, 0, 1)) * 255).astype(np.uint8), (CANON_W, CANON_H), interpolation=cv2.INTER_NEAREST)
    heat = cv2.addWeighted(ref, 0.55, cv2.applyColorMap(heat, cv2.COLORMAP_JET), 0.45, 0)
    blend = cv2.addWeighted(up, 0.5, ref, 0.5, 0)
    return {"sideBySide": to_png_b64(side), "diffHeatmap": to_png_b64(heat), "aligned": to_png_b64(blend)}
