"""Adaptive photo validation: specific, actionable issues per capture role."""
import cv2
import numpy as np
from . import geometry
from .imaging import glare_mask
from .hashing import phash

GUIDANCE = {
    "blur": "Image is blurry. Hold steady, tap to focus on the label, and brace your elbows.",
    "low_resolution": "Resolution is too low for detail inspection. Move closer or use the rear camera at full resolution.",
    "glare": "Glare covers part of the slab. Tilt the slab slightly away from the light or turn off overhead lights.",
    "underexposed": "Photo is too dark. Move to even, diffuse light.",
    "overexposed": "Photo is overexposed. Reduce direct light or move away from the window.",
    "edges_cut_off": "Part of the holder is cut off. Step back so all four edges are inside the frame.",
    "steep_angle": "Camera is at an angle. Hold the phone parallel to the slab, straight above it.",
    "subject_too_small": "The slab is too small in the frame. Move closer so it fills most of the photo.",
    "text_unreadable": "Label text is not readable. Take a closer, sharp shot of the label.",
    "motion_blur": "The photo is smeared from movement. Rest your elbows or the slab on a table and hold still for a second.",
    "label_blur": "The label isn't sharp enough to read the certification number. Tap the label to focus, or take a separate label close-up.",
}

MOTION_ANISOTROPY = 0.55   # 0 = isotropic detail, 1 = all detail in one direction
LABEL_MIN_SHARPNESS = 60.0 # Laplacian variance of the warped label region
ROLE_NEEDS_FULL_SLAB = {"front", "back", "reference_front", "reference_back"}


def assess(img: np.ndarray, role: str, item_rng=geometry._DEFAULT, holder_rng=geometry._DEFAULT) -> dict:
    h, w = img.shape[:2]
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # Sharpness normalized to a 1000px long side so scores are resolution independent.
    s = 1000 / max(h, w)
    gn = cv2.resize(g, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
    sharp = float(cv2.Laplacian(gn, cv2.CV_64F).var())
    mean = float(g.mean())
    p2, p98 = (float(x) for x in np.percentile(g, [2, 98]))
    glare = float((glare_mask(img) > 0).mean())
    issues = []

    def add(issue, severity):
        issues.append({"issue": issue, "severity": severity, "guidance": GUIDANCE[issue]})

    min_side = 1000 if role in ROLE_NEEDS_FULL_SLAB else 700
    if min(h, w) < min_side * 0.6:
        add("low_resolution", "major")
    elif min(h, w) < min_side:
        add("low_resolution", "minor")
    # Motion blur: gradient energy strongly concentrated in one direction (defocus blurs evenly).
    gx = cv2.Sobel(gn, cv2.CV_32F, 1, 0)
    gy = cv2.Sobel(gn, cv2.CV_32F, 0, 1)
    jxx, jyy, jxy = float((gx * gx).mean()), float((gy * gy).mean()), float((gx * gy).mean())
    tr = jxx + jyy
    disc = ((jxx - jyy) ** 2 + 4 * jxy ** 2) ** 0.5
    anisotropy = disc / tr if tr > 1e-6 else 0.0
    if anisotropy > MOTION_ANISOTROPY and sharp < 400:
        add("motion_blur", "major" if sharp < 150 else "minor")
    if sharp < 40:
        add("blur", "major")
    elif sharp < 90:
        add("blur", "minor")
    if mean < 50 or p98 < 110:
        add("underexposed", "major" if mean < 35 else "minor")
    if mean > 225 or p2 > 170:
        add("overexposed", "major" if mean > 240 else "minor")
    if glare > 0.12:
        add("glare", "major")
    elif glare > 0.04:
        add("glare", "minor")

    metrics = {"phash": format(phash(img), "016x"), "anisotropy": round(anisotropy, 3), "sharpness": round(sharp, 1), "meanLuma": round(mean, 1), "glareFrac": round(glare, 4), "width": w, "height": h}
    if role in ROLE_NEEDS_FULL_SLAB and not role.startswith("reference"):
        q = geometry.find_slab(img, holder_rng) or geometry.find_card(img, item_rng)
        metrics["subjectDetected"] = q is not None
        if q is not None:
            metrics["subjectAreaFrac"] = round(q.area_frac, 3)
            touch = q.touches_border(img.shape)
            if any(touch.values()):
                add("edges_cut_off", "major")
            ang = geometry.corner_angle_deviation(q.pts)
            metrics["angleDeviationDeg"] = round(ang, 1)
            if ang > 15:
                add("steep_angle", "major")
            elif ang > 8:
                add("steep_angle", "minor")
            # Label region (top of the holder) must be sharp enough to read at zoom.
            if role == "front" and q.area_frac >= 0.15:
                slab, _ = geometry.warp(img, q.pts, 620, 1000)
                lab = cv2.cvtColor(slab[: int(1000 * 0.22)], cv2.COLOR_BGR2GRAY)
                label_sharp = float(cv2.Laplacian(lab, cv2.CV_64F).var())
                metrics["labelSharpness"] = round(label_sharp, 1)
                if label_sharp < LABEL_MIN_SHARPNESS:
                    add("label_blur", "minor")
            if q.area_frac < 0.2:
                add("subject_too_small", "minor" if q.area_frac > 0.1 else "major")
        else:
            add("edges_cut_off", "minor")  # could not find all holder edges

    if role == "label_closeup" and sharp < 120 and not any(i["issue"] in ("blur", "motion_blur") for i in issues):
        add("label_blur", "minor")
    majors = sum(1 for i in issues if i["severity"] == "major")
    minors = len(issues) - majors
    score = max(0.0, 1 - 0.35 * majors - 0.1 * minors)
    return {"ok": majors == 0, "score": round(score, 2), "issues": issues, "metrics": metrics}
