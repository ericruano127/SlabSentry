"""Label vs. grader-image label comparison (tampering / label-swap indicator).

If the reference image shows the slab label (graders' cert photos usually show the whole
slab), the label in the user's photo should carry the same cert number and grade.
A grader reholder can change label design/generation, so layout differences alone are
inconclusive; differing cert/grade tokens are a potential discrepancy.
"""
from __future__ import annotations
import re
from difflib import SequenceMatcher
import numpy as np
from . import geometry, ocr
from .holder import SLAB_H, SLAB_W, LABEL_FRAC

TOKEN = re.compile(r"[A-Z0-9]+")


def _label(img, rng=geometry._DEFAULT):
    q = geometry.find_slab(img, rng)
    if q is None:
        return None
    slab, _ = geometry.warp(img, q.pts, SLAB_W, SLAB_H)
    return slab[: int(SLAB_H * LABEL_FRAC)]


def _tokens(lines: list[str]) -> set[str]:
    return {t for line in lines for t in TOKEN.findall(line.upper().replace(" ", " ")) if len(t) >= 2}


def compare_labels(upload: np.ndarray, reference: np.ndarray, upload_label_text: list[str] | None = None, holder_rng=geometry._DEFAULT) -> dict:
    lr = _label(reference, holder_rng)
    if lr is None:
        return {"status": "not_applicable", "note": "reference image does not show the slab label"}
    if not ocr.available():
        return {"status": "inconclusive", "note": "OCR unavailable"}
    ref_text = [r["text"] for r in ocr.read_text(lr)]
    if upload_label_text is None:
        lu = _label(upload, holder_rng)
        upload_label_text = [r["text"] for r in ocr.read_text(lu)] if lu is not None else []
    if not ref_text or not upload_label_text:
        return {"status": "inconclusive", "note": "label text not readable in both images", "referenceText": ref_text, "uploadText": upload_label_text}
    tr, tu = _tokens(ref_text), _tokens(upload_label_text)
    # OCR segments label text differently between images ("PSA10GEMMT12345678" vs "PSA 10 GEM MT
    # 12345678"), so compare digit runs with containment and whole-label character similarity.
    def runs(lines):
        out = set()
        for line in lines:
            out |= set(re.findall(r"\d{5,}", line))
            out |= set(re.findall(r"\d{5,}", re.sub(r"\s+", "", line)))
        return out
    nr, nu = runs(ref_text), runs(upload_label_text)
    cert_conflict = bool(nr and nu and not any(a in b or b in a for a in nr for b in nu))
    flat = lambda lines: re.sub(r"[^A-Z0-9]", "", " ".join(lines).upper())
    overlap = SequenceMatcher(None, flat(ref_text), flat(upload_label_text)).ratio()
    if cert_conflict:
        status = "potential_discrepancy"
    elif overlap >= 0.6:
        status = "consistent"
    else:
        status = "inconclusive"
    return {
        "status": status, "tokenOverlap": round(overlap, 2), "certConflict": cert_conflict,
        "missingFromUpload": sorted(tr - tu)[:15], "extraInUpload": sorted(tu - tr)[:15],
        "referenceText": ref_text, "uploadText": upload_label_text,
    }
