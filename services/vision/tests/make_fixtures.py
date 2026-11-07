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
