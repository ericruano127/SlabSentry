"""Image-manipulation indicators (Phase C). Conservative by design: every signal can be produced by
ordinary processing (screenshots, messaging apps, HDR, filters), so results are "inconclusive —
review" observations, never verdicts.

  recompression  EXPERIMENTAL — NOT USED IN REPORTS. Error-level analysis on 16px blocks. In
                 validation it flagged every clean test image (content-dependent), so the rules engine
                 ignores it; output is kept only to evaluate improved methods on labeled data.
  copy_move      keypoint self-matching: duplicated patches at distinct positions (clone-stamped
                 areas, duplicated label elements). Repeated print patterns are excluded by requiring
                 compact clusters with one consistent offset and a minimum size. Limitation: a single
                 cloned character is indistinguishable from naturally repeated glyphs and is not flagged.
"""
from __future__ import annotations
import cv2
import numpy as np

ELA_QUALITY = 90
ELA_BLOCK = 16
ELA_Z = 6.0
CM_MIN_DIST = 40
CM_MIN_CLUSTER = 8
CM_MIN_SIDE = 40       # px at analysis scale: repeated glyphs (e.g. '1' twice in a cert) are normal, so tiny clusters are ignored
CM_MAX_DESC = 90.0   # near-duplicate descriptors (JPEG re-save shifts them noticeably)
CM_OFFSET_TOL = 4.0  # px: clone offsets agree to within this


def recompression(img: np.ndarray) -> dict:
    ok, enc = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, ELA_QUALITY])
    re = cv2.imdecode(enc, cv2.IMREAD_COLOR)
    err = cv2.absdiff(img, re).astype(np.float32).mean(2)
    h, w = err.shape
    hb, wb = h // ELA_BLOCK, w // ELA_BLOCK
    if hb < 4 or wb < 4:
        return {"status": "inconclusive", "note": "image too small"}
    blocks = err[: hb * ELA_BLOCK, : wb * ELA_BLOCK].reshape(hb, ELA_BLOCK, wb, ELA_BLOCK).mean((1, 3))
    # compare blocks with similar texture only: normalise by local detail so flat areas don't dominate
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    detail = cv2.Laplacian(g, cv2.CV_32F)
    det = np.abs(detail[: hb * ELA_BLOCK, : wb * ELA_BLOCK]).reshape(hb, ELA_BLOCK, wb, ELA_BLOCK).mean((1, 3)) + 1.0
    ratio = blocks / det
    med = np.median(ratio)
    mad = np.median(np.abs(ratio - med)) * 1.4826 + 1e-6
    z = (ratio - med) / mad
    hits = np.argwhere(np.abs(z) > ELA_Z)
    regions = []
    if len(hits):
        mask = (np.abs(z) > ELA_Z).astype(np.uint8)
        n, _, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
        for i in range(1, n):
            x, y, bw, bh, area = stats[i]
            if area >= 4:  # ≥ 4 blocks (64×64 px) — ignore isolated noise
                regions.append({"x": x / wb, "y": y / hb, "w": bw / wb, "h": bh / hb, "label": "recompression outlier"})
    return {"status": "inconclusive" if regions else "consistent", "regions": regions[:8], "outlierBlocks": int(len(hits))}


def copy_move(img: np.ndarray) -> dict:
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    s = min(1.0, 1600 / max(g.shape))
    g = cv2.resize(g, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    sift = cv2.SIFT_create(nfeatures=6000)
    kp, des = sift.detectAndCompute(g, None)
    if des is None or len(kp) < 50:
        return {"status": "inconclusive", "note": "not enough detail"}
    pairs = []
    for row in cv2.BFMatcher(cv2.NORM_L2).knnMatch(des, des, k=5):
        for cand in row:
            if cand.trainIdx == cand.queryIdx or cand.distance > CM_MAX_DESC:
                continue
            a, b = np.array(kp[cand.queryIdx].pt), np.array(kp[cand.trainIdx].pt)
            if np.linalg.norm(a - b) > CM_MIN_DIST and (b[0], b[1]) > (a[0], a[1]):  # count each pair once
                pairs.append((a, b))
    if len(pairs) < CM_MIN_CLUSTER:
        return {"status": "consistent", "pairs": len(pairs)}
    offs = np.array([b - a for a, b in pairs])
    H, W = g.shape
    regions, used = [], np.zeros(len(pairs), bool)
    for i in np.argsort(np.linalg.norm(offs, axis=1)):
        if used[i]:
            continue
        member = (np.linalg.norm(offs - offs[i], axis=1) < CM_OFFSET_TOL) & ~used
        used |= member
        if member.sum() < CM_MIN_CLUSTER:
            continue
        pts = np.array([pairs[j][0] for j in np.where(member)[0]])
        x0, y0 = pts.min(0); x1, y1 = pts.max(0)
        # a clone is a compact cluster with one consistent offset; spread-out repeats are print patterns
        if (x1 - x0) * (y1 - y0) < 0.08 * W * H and min(x1 - x0, y1 - y0) >= CM_MIN_SIDE:
            o = offs[i]
            regions.append({"x": x0 / W, "y": y0 / H, "w": max(x1 - x0, 10) / W, "h": max(y1 - y0, 10) / H, "label": f"duplicated region (offset {int(o[0] / s)},{int(o[1] / s)}px)"})
    return {"status": "inconclusive" if regions else "consistent", "regions": regions[:6], "pairs": len(pairs)}


def analyze(img: np.ndarray) -> dict:
    return {"recompression": recompression(img), "copyMove": copy_move(img), "toolVersion": "vision/forensics@0.1.0"}
