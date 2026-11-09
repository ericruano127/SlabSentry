"""Write synthetic slab photos for end-to-end tests: python -m tests.make_fixtures <outdir>"""
import sys
from pathlib import Path
import cv2
from tests import synth

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
art = synth.artwork(7)
genuine, other = synth.card(art), synth.card(art, cut_dx=38, cut_dy=-30, marks_seed=3)
qr = "https://www.psacard.com/cert/12345678"
cv2.imwrite(str(out / "reference.jpg"), synth.photo(synth.slab(genuine, qr_text=qr), seed=1), [cv2.IMWRITE_JPEG_QUALITY, 92])
cv2.imwrite(str(out / "front_genuine.jpg"), synth.photo(synth.slab(genuine, qr_text=qr), angle=2, scale=0.85, seed=5), [cv2.IMWRITE_JPEG_QUALITY, 92])
cv2.imwrite(str(out / "front_other_copy.jpg"), synth.photo(synth.slab(other, qr_text=qr), angle=-2, seed=6), [cv2.IMWRITE_JPEG_QUALITY, 92])
cv2.imwrite(str(out / "front_blurry.jpg"), cv2.GaussianBlur(synth.photo(synth.slab(genuine), seed=2), (0, 0), 9))
print("ok", out)

# ---- Phase 2 fixtures ----
import numpy as np  # noqa: E402

marked = synth.card(art, marks_seed=3)
cv2.imwrite(str(out / "front_marked_copy.jpg"), synth.photo(synth.slab(marked, qr_text=qr), angle=-1, seed=6), [cv2.IMWRITE_JPEG_QUALITY, 95])
cv2.imwrite(str(out / "front_label_swap.jpg"), synth.photo(synth.slab(genuine, label_text="PSA 10 GEM MT 87654321", qr_text=qr), seed=7), [cv2.IMWRITE_JPEG_QUALITY, 95])
cv2.imwrite(str(out / "reference_labeled.jpg"), synth.photo(synth.slab(genuine, label_text="PSA 10 GEM MT 12345678", qr_text=qr), seed=1), [cv2.IMWRITE_JPEG_QUALITY, 95])
base = cv2.resize(synth.slab(genuine), (480, 640))
vw = cv2.VideoWriter(str(out / "tilt.mp4"), cv2.VideoWriter_fourcc(*"mp4v"), 10, (480, 640))
for k in range(40):
    f = base.copy()
    hsv = cv2.cvtColor(f, cv2.COLOR_BGR2HSV)
    hsv[20:110, 40:200, 0] = (k * 4) % 180
    hsv[20:110, 40:200, 1:] = 200
    vw.write(cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR))
vw.release()
edge = np.full((900, 1300, 3), 200, np.uint8)
edge[450:, :] = 120
cv2.imwrite(str(out / "edge_clean.jpg"), edge)
print("phase2 fixtures ok")
