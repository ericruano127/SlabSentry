"""Local OCR (RapidOCR / ONNX). Lazily loaded; returns [] if unavailable so the
pipeline degrades to QR/barcode + user-confirmed entry."""
import threading
import numpy as np

_engine = None
_lock = threading.Lock()
_failed = False


def _get():
    global _engine, _failed
    if _engine is None and not _failed:
        with _lock:
            if _engine is None and not _failed:
                try:
                    from rapidocr_onnxruntime import RapidOCR
                    _engine = RapidOCR()
                except Exception:  # pragma: no cover
                    _failed = True
    return _engine


def available() -> bool:
    return _get() is not None


def read_text(img: np.ndarray, min_score: float = 0.5) -> list[dict]:
    eng = _get()
    if eng is None:
        return []
    result, _ = eng(img)
    out = []
    for box, text, score in result or []:
        if float(score) >= min_score:
            xs = [p[0] for p in box]
            ys = [p[1] for p in box]
            out.append({"text": text, "score": float(score), "box": [min(xs), min(ys), max(xs), max(ys)]})
    return out
