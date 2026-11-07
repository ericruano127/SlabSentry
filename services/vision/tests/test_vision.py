import cv2
import numpy as np
from fastapi.testclient import TestClient
from app import compare, holder, quality
from app.main import app
from tests import synth

ART = synth.artwork(7)
GENUINE = synth.card(ART)
OTHER_COPY = synth.card(ART, cut_dx=38, cut_dy=-30, marks_seed=3)
OTHER_CARD = synth.card(synth.artwork(99))
REF = synth.photo(synth.slab(GENUINE), seed=1)


def test_same_physical_card_matches():
    up = synth.photo(synth.slab(GENUINE), angle=3, scale=0.8, light=0.9, seed=5)
    r = compare.compare(up, REF)
    assert r["designMatch"]["status"] == "consistent"
    assert r["centering"]["status"] == "consistent", r["centering"]
    assert r["localDifferences"]["status"] in ("consistent", "inconclusive")
    assert r["overlays"]["sideBySide"]


def test_same_design_different_copy_detected():
    up = synth.photo(synth.slab(OTHER_COPY), angle=-2, seed=6)
    r = compare.compare(up, REF)
    assert r["designMatch"]["status"] == "consistent"
    assert r["centering"]["status"] == "potential_discrepancy", r["centering"]


def test_different_card_is_design_discrepancy():
    up = synth.photo(synth.slab(OTHER_CARD), seed=8)
    r = compare.compare(up, REF)
    assert r["designMatch"]["status"] == "potential_discrepancy", r["diagnostics"]


def test_photo_reuse_detected():
    r = compare.compare(REF.copy(), REF)
    assert r["photoReuse"]["nearIdentical"]


def test_quality_flags_blur_and_cutoff():
    sharp = synth.photo(synth.slab(GENUINE), seed=2)
    assert quality.assess(sharp, "front")["ok"], quality.assess(sharp, "front")
    blurred = cv2.GaussianBlur(sharp, (0, 0), 9)
    assert "blur" in [i["issue"] for i in quality.assess(blurred, "front")["issues"]]
    crop = sharp[sharp.shape[0] // 3:, :]
    assert "edges_cut_off" in [i["issue"] for i in quality.assess(crop, "front")["issues"]]


def test_holder_reads_qr_and_edges():
    img = synth.photo(synth.slab(GENUINE, qr_text="https://www.psacard.com/cert/12345678"), seed=3)
    r = holder.inspect(img)
    assert r["slabDetected"]
    assert all(r["edgesVisible"].values())
    assert r["edgeStraightness"]["status"] == "consistent", r["edgeStraightness"]
    assert any("12345678" in c["data"] for c in r["codes"])


def test_tilt_detects_hue_shift():
    base = synth.slab(GENUINE)
    frames = []
    for k in range(4):
        f = base.copy()
        hsv = cv2.cvtColor(f, cv2.COLOR_BGR2HSV)
        region = hsv[40:200, 60:300]
        region[..., 0] = (30 * k + 20) % 180
        region[..., 1] = 200
        region[..., 2] = 200
        frames.append(cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR))
    assert holder.tilt_variation(frames)["status"] == "consistent"
    assert holder.tilt_variation([base, base.copy()])["status"] == "inconclusive"


def test_api_compare_endpoint():
    c = TestClient(app)
    enc = lambda im: cv2.imencode(".jpg", im)[1].tobytes()
    up = synth.photo(synth.slab(GENUINE), seed=9)
    r = c.post("/compare", files={"upload": ("u.jpg", enc(up)), "reference": ("r.jpg", enc(REF))})
    assert r.status_code == 200 and r.json()["designMatch"]["status"] == "consistent"
    assert c.post("/quality", files={"image": ("x.jpg", b"notimage")}).status_code == 422


def test_glare_flagged():
    img = synth.photo(synth.slab(GENUINE), seed=2)
    cv2.ellipse(img, (img.shape[1] // 2, img.shape[0] // 2), (300, 200), 0, 0, 360, (255, 255, 255), -1)
    assert "glare" in [i["issue"] for i in quality.assess(img, "front")["issues"]]


def test_ocr_reads_label():
    from app import ocr
    img = synth.photo(synth.slab(GENUINE, label_text="PSA 10 GEM MT 12345678"), seed=4)
    r = holder.inspect(img)
    if not ocr.available():
        return  # OCR optional; pipeline degrades to QR + user entry
    assert any("12345678" in t.replace(" ", "") for t in r["ocrText"]), r["ocrText"]
