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
}

ROLE_NEEDS_FULL_SLAB = {"front", "back", "reference_front", "reference_back"}


def assess(img: np.ndarray, role: str) -> dict:
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

    metrics = {"phash": format(phash(img), "016x"), "sharpness": round(sharp, 1), "meanLuma": round(mean, 1), "glareFrac": round(glare, 4), "width": w, "height": h}
    if role in ROLE_NEEDS_FULL_SLAB and not role.startswith("reference"):
        q = geometry.find_slab(img) or geometry.find_card(img)
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
            if q.area_frac < 0.2:
                add("subject_too_small", "minor" if q.area_frac > 0.1 else "major")
        else:
            add("edges_cut_off", "minor")  # could not find all holder edges

    majors = sum(1 for i in issues if i["severity"] == "major")
    minors = len(issues) - majors
    score = max(0.0, 1 - 0.35 * majors - 0.1 * minors)
    return {"ok": majors == 0, "score": round(score, 2), "issues": issues, "metrics": metrics}
