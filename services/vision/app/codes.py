import cv2
import numpy as np


def decode_codes(img: np.ndarray) -> list[dict]:
    found: dict[str, str] = {}
    candidates = [img]
    h, w = img.shape[:2]
    if max(h, w) < 1600:
        candidates.append(cv2.resize(img, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC))
    qr = cv2.QRCodeDetector()
    for c in candidates:
        try:
            ok, datas, _, _ = qr.detectAndDecodeMulti(c)
            if ok:
                for d in datas:
                    if d:
                        found[d] = "qr"
        except cv2.error:
            pass
        if hasattr(cv2, "barcode"):
            try:
                res = cv2.barcode.BarcodeDetector().detectAndDecodeWithType(c)
                ok = res[0]
                infos = res[1] if len(res) > 1 else ()
                if ok:
                    for d in infos:
                        if d:
                            found.setdefault(d, "barcode")
            except (cv2.error, ValueError, TypeError):
                pass
    return [{"type": t, "data": d} for d, t in found.items()]
