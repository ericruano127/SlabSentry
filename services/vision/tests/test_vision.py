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


# ---------------- Phase 2 ----------------
from app import fingerprint, seam, video  # noqa: E402


def _fp(up, ref):
    r = compare.compare(up, ref)
    assert r["designMatch"]["status"] == "consistent"
    return r, r["fingerprint"]


def test_fingerprint_same_copy_all_signals_agree():
    _, f = _fp(synth.photo(synth.slab(GENUINE), angle=2, scale=0.85, light=0.9, seed=5), REF)
    assert f["marks"]["status"] == "consistent" and f["registration"]["status"] == "consistent"


def test_fingerprint_unique_marks_flagged_with_regions():
    marked = synth.card(ART, marks_seed=3)
    r, f = _fp(synth.photo(synth.slab(marked), angle=-1, seed=6), REF)
    assert f["marks"]["status"] == "potential_discrepancy"
    assert f["marks"]["onlyInUpload"], "marks must be localized for the report"
    assert r["centering"]["status"] == "consistent"  # same cut: only the marks differ


def test_fingerprint_registration_shift():
    shifted = GENUINE.copy()
    shifted[..., 2] = np.roll(shifted[..., 2], 4, axis=1)
    _, f = _fp(synth.photo(synth.slab(shifted), seed=8), REF)
    assert f["registration"]["status"] == "potential_discrepancy"


def test_edge_profile_matches_same_wear_and_rejects_different_wear():
    worn = synth.card(ART, chip_seed=11)
    ref = synth.photo(synth.slab(worn), seed=1)
    _, same = _fp(synth.photo(synth.slab(worn), angle=2, scale=0.9, seed=4), ref)
    _, other = _fp(synth.photo(synth.slab(synth.card(ART, chip_seed=12)), angle=-2, seed=5), ref)
    assert same["edgeProfile"]["status"] == "consistent", same["edgeProfile"]
    assert other["edgeProfile"]["status"] == "potential_discrepancy", other["edgeProfile"]


def test_low_resolution_makes_fine_signals_inconclusive():
    small = synth.photo(synth.slab(GENUINE), scale=0.4, seed=3)
    _, f = _fp(small, REF)
    assert f["lowResolution"] and f["marks"]["status"] == "inconclusive"


def test_label_swap_detected():
    from app import ocr
    if not ocr.available():
        return
    ref = synth.photo(synth.slab(GENUINE, label_text="PSA 10 GEM MT 12345678"), seed=1)
    up = synth.photo(synth.slab(GENUINE, label_text="PSA 10 GEM MT 87654321"), seed=2)
    r = compare.compare(up, ref)
    assert r["labelComparison"]["status"] == "potential_discrepancy", r["labelComparison"]
    same = compare.compare(synth.photo(synth.slab(GENUINE, label_text="PSA 10 GEM MT 12345678"), seed=3), ref)
    assert same["labelComparison"]["status"] == "consistent"


def _write_video(frames, path):
    h, w = frames[0].shape[:2]
    vw = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), 10, (w, h))
    for f in frames:
        vw.write(f)
    vw.release()
    return open(path, "rb").read()


def test_video_frames_are_distinct(tmp_path):
    base = cv2.resize(synth.slab(GENUINE), (480, 640))
    frames = []
    for k in range(40):
        f = base.copy()
        hsv = cv2.cvtColor(f, cv2.COLOR_BGR2HSV)
        hsv[20:110, 40:200, 0] = (k * 4) % 180
        hsv[20:110, 40:200, 1:] = 200
        frames.append(cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR))
    r = video.extract_frames(_write_video(frames, str(tmp_path / "t.mp4")), 6)
    assert r["status"] == "ok" and 3 <= r["distinctFrames"] <= 6
    static = video.extract_frames(_write_video([base] * 30, str(tmp_path / "s.mp4")), 6)
    assert static["distinctFrames"] == 1 and static["status"] == "too_few_distinct_frames"


def test_seam_review():
    img = np.full((600, 900, 3), 200, np.uint8)
    img[300:, :] = 120
    clean = seam.review_edge(img)
    assert clean["status"] == "consistent", clean
    cracked = img.copy()
    cv2.rectangle(cracked, (430, 285), (470, 315), (255, 255, 255), -1)
    r = seam.review_edge(cracked)
    assert r["status"] == "inconclusive" and r["anomalies"] >= 1, r


def test_label_comparison_tolerates_ocr_segmentation():
    from app import ocr
    if not ocr.available():
        return
    ref = synth.photo(synth.slab(GENUINE, label_text="PSA 10 GEM MT 12345678"), seed=1)
    up = synth.photo(synth.slab(GENUINE, label_text="PSA 10 GEM MT 12345678"), seed=9)
    from app.label import compare_labels
    # upload text as a label close-up would give it: separate words
    r = compare_labels(up, ref, ["PSA", "10", "GEM MT", "12345678"])
    assert r["status"] == "consistent" and not r["certConflict"], r


def test_category_geometry_generic_shapes():
    """Comic-shaped item (aspect 0.60) is outside card priors; generic geometry still finds and aligns it."""
    art = synth.artwork(21, w=840, h=1400)
    item = synth.card(art)
    ref = synth.photo(synth.slab(item), seed=1)
    up = synth.photo(synth.slab(item), angle=2, scale=0.85, seed=5)
    card_priors = compare.compare(up, ref)
    assert not card_priors["diagnostics"]["cardDetected"]["upload"]
    generic = compare.compare(up, ref, None, None, None)
    assert generic["diagnostics"]["cardDetected"]["upload"], generic["diagnostics"]
    assert generic["designMatch"]["status"] == "consistent"
    assert generic["centering"]["status"] == "consistent", generic["centering"]


def test_geometry_form_field():
    from app.geometry import parse_geometry, _DEFAULT
    assert parse_geometry(None) == (_DEFAULT, _DEFAULT)
    assert parse_geometry('{"itemAspect": null, "holderAspect": [0.5, 0.7]}') == (None, (0.5, 0.7))


# ---------------- Phase C ----------------
from app import forensics, microprint, template, uv  # noqa: E402
from app.hashing import hamming  # noqa: E402


def _jpeg(img, q=92):
    return cv2.imdecode(cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, q])[1], cv2.IMREAD_COLOR)


def test_copy_move_detects_cloned_region():
    clean = _jpeg(synth.photo(synth.slab(GENUINE), seed=11))
    assert forensics.copy_move(clean)["status"] == "consistent"
    forged = clean.copy()
    h, w = forged.shape[:2]
    patch = forged[int(h * 0.45):int(h * 0.45) + 200, int(w * 0.30):int(w * 0.30) + 240].copy()
    forged[int(h * 0.70):int(h * 0.70) + 200, int(w * 0.55):int(w * 0.55) + 240] = patch
    r = forensics.copy_move(forged)
    assert r["status"] == "inconclusive" and r["regions"], r


def _uv_scene(rect):
    img = np.zeros((600, 800, 3), np.uint8)
    img[:] = cv2.cvtColor(np.uint8([[[140, 200, 70]]]), cv2.COLOR_HSV2BGR)[0, 0]  # violet-lit dark scene
    x, y, w, h = rect
    cv2.rectangle(img, (x, y), (x + w, y + h), (80, 255, 120), -1)  # green-ish fluorescence
    return img


def test_uv_pattern_vs_template():
    a, same, other = _uv_scene((100, 100, 200, 80)), _uv_scene((105, 102, 200, 80)), _uv_scene((500, 400, 200, 80))
    assert uv.analyze(a, same)["status"] == "consistent"
    assert uv.analyze(a, other)["status"] == "potential_discrepancy"
    assert uv.analyze(a)["status"] == "inconclusive"
    assert uv.analyze(synth.photo(synth.slab(GENUINE), seed=1))["status"] == "not_visible"


def _microtext(seed=0):
    img = np.full((900, 1200, 3), 240, np.uint8)
    rng = np.random.default_rng(seed)
    for row in range(0, 900, 14):
        txt = "".join(rng.choice(list("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"), 90))
        cv2.putText(img, txt, (5, row + 11), cv2.FONT_HERSHEY_PLAIN, 0.8, (30, 30, 30), 1)
    return img


def test_microprint_resolvability_and_template():
    sharp = _microtext(1)
    r = microprint.analyze(sharp)
    assert r["resolvable"] and r["status"] == "inconclusive"
    blurred = cv2.GaussianBlur(sharp, (0, 0), 6)
    assert microprint.analyze(blurred)["status"] == "not_supported_by_device"
    assert microprint.analyze(sharp, _microtext(1))["status"] == "consistent"


def test_label_template_layout_and_colour():
    ref = synth.photo(synth.slab(GENUINE, label_text="PSA 10 GEM MT 12345678"), seed=1)
    tpl, _ = template.label_crop(ref)
    same_design = synth.photo(synth.slab(GENUINE, label_text="PSA 9 MINT 87651234"), seed=3)
    r = template.compare_label(same_design, tpl)
    assert r["layout"]["status"] != "potential_discrepancy" and r["colour"]["status"] == "consistent", r
    other = synth.photo(synth.slab(GENUINE, label_color=(60, 170, 60), border_color=(20, 20, 20), logo=True), seed=4)  # different label design
    r2 = template.compare_label(other, tpl)
    assert r2["status"] == "measured" and r2["colour"]["status"] == "potential_discrepancy", r2


def test_item_hash_same_vs_different_item():
    a = template.item_hash(synth.photo(synth.slab(GENUINE), seed=1))
    b = template.item_hash(synth.photo(synth.slab(GENUINE), angle=2, scale=0.85, seed=5))
    c = template.item_hash(synth.photo(synth.slab(OTHER_CARD), seed=8))
    d = lambda x, y: hamming(int(x["phash"], 16), int(y["phash"], 16))
    assert d(a, b) <= 10, d(a, b)
    assert d(a, c) >= 20, d(a, c)
    p = template.proportions(synth.photo(synth.slab(GENUINE), seed=1))
    assert p["status"] == "measured" and 0.5 < p["holderAspect"] < 0.7


def test_copy_move_no_false_positives_on_clean_slabs():
    """Repeated glyphs/corners on genuine labels must not trigger duplication flags."""
    for card in (GENUINE, OTHER_CARD, OTHER_COPY):
        for seed in (3, 7, 13):
            assert forensics.copy_move(_jpeg(synth.photo(synth.slab(card), seed=seed)))["status"] == "consistent", seed


def test_phase_c_endpoints_return_json():
    """Regression: NumPy types must be converted before FastAPI serializes responses."""
    c = TestClient(app)
    enc = lambda im: cv2.imencode(".jpg", im)[1].tobytes()
    img = enc(synth.photo(synth.slab(GENUINE), seed=2))
    for path, files in [("/forensics", {"image": img}), ("/uv", {"image": img}), ("/microprint", {"image": img}),
                        ("/label-template", {"image": img, "template_image": img})]:
        r = c.post(path, files={k: (f"{k}.jpg", v) for k, v in files.items()})
        assert r.status_code == 200, (path, r.text[:200])
