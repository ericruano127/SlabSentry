"""Synthetic slab generator for deterministic tests. A 'card' is procedural artwork
with a printed frame; different 'copies' share artwork but differ in cut offset and
surface marks — exactly the property the fingerprint stage must detect."""
import cv2
import numpy as np


def artwork(seed=1, w=900, h=1260):
    rng = np.random.default_rng(seed)
    img = np.full((h, w, 3), 235, np.uint8)
    for _ in range(140):
        c = tuple(int(x) for x in rng.integers(0, 255, 3))
        p = rng.integers(0, [w, h])
        if rng.random() < 0.5:
            cv2.circle(img, (int(p[0]), int(p[1])), int(rng.integers(8, 70)), c, -1)
        else:
            q = p + rng.integers(-120, 120, 2)
            cv2.rectangle(img, (int(p[0]), int(p[1])), (int(q[0]), int(q[1])), c, -1)
    noise = rng.normal(0, 6, img.shape)
    img = np.clip(img + noise, 0, 255).astype(np.uint8)
    cv2.putText(img, "SYNTH STAR #23", (60, h - 80), cv2.FONT_HERSHEY_SIMPLEX, 2, (20, 20, 20), 4)
    return img


def card(art, cut_dx=0, cut_dy=0, border=60, marks_seed=None, chip_seed=None):
    """Print artwork on a sheet then cut a card; cut offset changes centering."""
    h, w = art.shape[:2]
    sheet = np.full((h + 4 * border, w + 4 * border, 3), 250, np.uint8)
    sheet[2 * border: 2 * border + h, 2 * border: 2 * border + w] = art
    cv2.rectangle(sheet, (2 * border - 4, 2 * border - 4), (2 * border + w + 4, 2 * border + h + 4), (30, 30, 30), 6)
    y0, x0 = border + cut_dy, border + cut_dx
    c = sheet[y0: y0 + h + 2 * border, x0: x0 + w + 2 * border].copy()
    if marks_seed is not None:
        rng = np.random.default_rng(marks_seed)
        for _ in range(10):
            p = rng.integers(100, [c.shape[1] - 100, c.shape[0] - 100])
            cv2.line(c, tuple(int(v) for v in p), tuple(int(v) for v in p + rng.integers(-60, 60, 2)), (0, 0, 0), 3)
    if chip_seed is not None:  # edge wear: irregular bites along the cut edges
        rng = np.random.default_rng(chip_seed)
        H, W = c.shape[:2]
        for _ in range(60):
            side = rng.integers(0, 4)
            t = rng.uniform(0.1, 0.9)
            r = int(rng.integers(3, 9))
            x, y = [(int(t * W), 0), (W - 1, int(t * H)), (int(t * W), H - 1), (0, int(t * H))][side]
            cv2.circle(c, (x, y), r, (205, 205, 205), -1)
    return c


def slab(card_img, label_text="PSA 10 GEM MT 12345678", qr_text=None, label_color=(236, 236, 236), border_color=(40, 40, 200), logo=False):
    ch, cw = card_img.shape[:2]
    W, H = int(cw * 1.28), int(ch * 1.62)
    s = np.full((H, W, 3), 205, np.uint8)
    cv2.rectangle(s, (0, 0), (W - 1, H - 1), (60, 60, 60), 8)
    lh = int(H * 0.18)
    cv2.rectangle(s, (40, 30), (W - 40, 30 + lh), label_color, -1)
    cv2.rectangle(s, (40, 30), (W - 40, 30 + lh), border_color, 6)
    if logo:
        cv2.circle(s, (W // 2, 30 + lh // 2), lh // 3, (0, 140, 255), -1)
    cv2.putText(s, label_text, (70, 30 + lh // 2), cv2.FONT_HERSHEY_SIMPLEX, 1.6, (0, 0, 0), 3)
    if qr_text:
        enc = cv2.QRCodeEncoder.create().encode(qr_text)
        qr = cv2.resize(enc, (lh - 40, lh - 40), interpolation=cv2.INTER_NEAREST)
        qr = cv2.cvtColor(qr, cv2.COLOR_GRAY2BGR)
        s[50: 50 + qr.shape[0], W - 60 - qr.shape[1]: W - 60] = qr
    y0 = 30 + lh + (H - 30 - lh - ch) // 2
    x0 = (W - cw) // 2
    s[y0: y0 + ch, x0: x0 + cw] = card_img
    cv2.rectangle(s, (x0 - 3, y0 - 3), (x0 + cw + 3, y0 + ch + 3), (15, 15, 15), 3)
    return s


def photo(slab_img, angle=0.0, scale=0.9, light=1.0, pad=150, seed=0):
    """Place slab on a background with mild perspective, lighting and noise."""
    h, w = slab_img.shape[:2]
    canvas = np.full((h + 2 * pad, w + 2 * pad, 3), 70, np.uint8)
    canvas[pad: pad + h, pad: pad + w] = slab_img
    H, W = canvas.shape[:2]
    rng = np.random.default_rng(seed)
    src = np.float32([[0, 0], [W, 0], [W, H], [0, H]])
    j = rng.uniform(-0.015, 0.015, (4, 2)) * [W, H]
    dst = (src + j).astype(np.float32)
    M = cv2.getPerspectiveTransform(src, dst)
    out = cv2.warpPerspective(canvas, M, (W, H), borderValue=(70, 70, 70))
    if angle:
        R = cv2.getRotationMatrix2D((W / 2, H / 2), angle, 1)
        out = cv2.warpAffine(out, R, (W, H), borderValue=(70, 70, 70))
    out = cv2.resize(out, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    out = np.clip(out.astype(np.float32) * light + rng.normal(0, 2, out.shape), 0, 255).astype(np.uint8)
    return out
