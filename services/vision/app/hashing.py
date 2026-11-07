import cv2
import numpy as np


def phash(img: np.ndarray) -> int:
    g = cv2.resize(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img, (32, 32), interpolation=cv2.INTER_AREA)
    d = cv2.dct(np.float32(g))[:8, :8]
    med = np.median(d.ravel()[1:])
    bits = (d > med).ravel()
    return int("".join("1" if b else "0" for b in bits), 2)


def dhash(img: np.ndarray) -> int:
    g = cv2.resize(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img, (9, 8), interpolation=cv2.INTER_AREA)
    bits = (g[:, 1:] > g[:, :-1]).ravel()
    return int("".join("1" if b else "0" for b in bits), 2)


def hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")
