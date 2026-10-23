"""The metric maths, on plain numpy arrays (embeddings, frames, flows, audio), so it is tested
without any model. The model wrappers in models.py only turn media into these arrays."""

from __future__ import annotations

import numpy as np


def l2norm(x: np.ndarray, axis: int = -1) -> np.ndarray:
    x = np.asarray(x, dtype=np.float64)
    n = np.linalg.norm(x, axis=axis, keepdims=True)
    return x / np.where(n == 0, 1, n)


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine similarity of two vectors (0 when either is all zeros)."""
    return float(np.dot(l2norm(a), l2norm(b)))


def clip_score(image_emb: np.ndarray, text_emb: np.ndarray) -> float:
    """CLIPScore as torchmetrics defines it: 100 * max(cos(image, text), 0). Higher follows the prompt better."""
    return 100.0 * max(cosine(image_emb, text_emb), 0.0)


def mean_clip_score(image_embs: np.ndarray, text_emb: np.ndarray) -> float:
    """A clip's score is the mean over its sampled frames."""
    return float(np.mean([clip_score(e, text_emb) for e in np.atleast_2d(image_embs)]))


def reference_similarity(emb: np.ndarray, refs: np.ndarray) -> dict:
    """How close an output is to a reference set: to the set's centroid and to its nearest member."""
    refs = l2norm(np.atleast_2d(refs))
    e = l2norm(emb)
    centroid = l2norm(refs.mean(axis=0))
    sims = refs @ e
    return {"centroid": float(centroid @ e), "nearest": float(sims.max()), "n": int(len(refs))}


def drift(frame_embs: np.ndarray) -> dict:
    """Frame-to-frame embedding drift: 1 - cos between consecutive frames (0 = no change). Lower is steadier."""
    e = l2norm(np.atleast_2d(frame_embs))
    if len(e) < 2:
        return {"mean": 0.0, "max": 0.0, "pairs": 0}
    d = 1.0 - np.sum(e[1:] * e[:-1], axis=1)
    d = np.clip(d, 0.0, 2.0)
    return {"mean": float(d.mean()), "max": float(d.max()), "pairs": int(len(d))}


def warp_backward(image: np.ndarray, flow: np.ndarray) -> np.ndarray:
    """Sample `image` (H×W×C, float) at x + flow(x) with bilinear interpolation (edges clamped)."""
    h, w = image.shape[:2]
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float64)
    x = np.clip(xs + flow[..., 0], 0, w - 1)
    y = np.clip(ys + flow[..., 1], 0, h - 1)
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    x1 = np.minimum(x0 + 1, w - 1)
    y1 = np.minimum(y0 + 1, h - 1)
    wx = (x - x0)[..., None]
    wy = (y - y0)[..., None]
    img = image if image.ndim == 3 else image[..., None]
    top = img[y0, x0] * (1 - wx) + img[y0, x1] * wx
    bottom = img[y1, x0] * (1 - wx) + img[y1, x1] * wx
    out = top * (1 - wy) + bottom * wy
    return out if image.ndim == 3 else out[..., 0]


def valid_flow_mask(flow_fw: np.ndarray, flow_bw: np.ndarray, alpha: float = 0.01, beta: float = 0.5) -> np.ndarray:
    """Forward-backward consistency (Sundaram et al. 2010): pixels whose flow round trip doesn't come back are occluded."""
    bw_at = warp_backward(flow_bw, flow_fw)
    diff = np.sum((flow_fw + bw_at) ** 2, axis=-1)
    bound = alpha * (np.sum(flow_fw**2, axis=-1) + np.sum(bw_at**2, axis=-1)) + beta
    h, w = flow_fw.shape[:2]
    ys, xs = np.mgrid[0:h, 0:w]
    inside = (xs + flow_fw[..., 0] >= 0) & (xs + flow_fw[..., 0] <= w - 1) & (ys + flow_fw[..., 1] >= 0) & (ys + flow_fw[..., 1] <= h - 1)
    return (diff <= bound) & inside


def warp_error(frame0: np.ndarray, frame1: np.ndarray, flow: np.ndarray, mask: np.ndarray | None = None) -> float:
    """
    Mean absolute photometric error (0–1) between frame0 and frame1 warped back along the flow
    frame0 → frame1, over the pixels in `mask`. Flicker and texture boiling raise it; real motion
    that the flow follows doesn't.
    """
    a = np.asarray(frame0, dtype=np.float64)
    b = warp_backward(np.asarray(frame1, dtype=np.float64), flow)
    err = np.abs(a - b)
    if err.ndim == 3:
        err = err.mean(axis=-1)
    if a.max() > 1.5:
        err = err / 255.0
    if mask is not None:
        if not mask.any():
            return float("nan")
        return float(err[mask].mean())
    return float(err.mean())


def frame_envelope(audio: np.ndarray, sr: int, fps: float, frames: int) -> np.ndarray:
    """The audio's RMS loudness for each video frame (frames values)."""
    audio = np.asarray(audio, dtype=np.float64)
    hop = sr / fps
    out = np.zeros(frames)
    for i in range(frames):
        a = int(round(i * hop))
        b = int(round((i + 1) * hop))
        seg = audio[a:b]
        out[i] = float(np.sqrt(np.mean(seg**2))) if len(seg) else 0.0
    return out


def motion_energy(frames: np.ndarray) -> np.ndarray:
    """Mean absolute change of a region between consecutive frames (len(frames) values; the first copies the second)."""
    f = np.asarray(frames, dtype=np.float64)
    if len(f) < 2:
        return np.zeros(len(f))
    d = np.abs(np.diff(f, axis=0)).reshape(len(f) - 1, -1).mean(axis=1)
    return np.concatenate([[d[0]], d])


def best_lag_correlation(a: np.ndarray, b: np.ndarray, max_lag: int) -> dict:
    """
    The Pearson correlation of two series at the lag (b shifted by -max_lag..max_lag samples) where it
    is highest. A lip-sync proxy: the mouth region's motion against the voice's loudness, with the
    lag as the audio/video offset in frames.
    """
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    n = min(len(a), len(b))
    a, b = a[:n], b[:n]
    best = {"corr": 0.0, "lag": 0, "overlap": 0}
    for lag in range(-max_lag, max_lag + 1):
        x = a[max(0, lag) : n + min(0, lag)]
        y = b[max(0, -lag) : n - max(0, lag)]
        if len(x) < 4 or x.std() == 0 or y.std() == 0:
            continue
        r = float(np.corrcoef(x, y)[0, 1])
        if r > best["corr"]:
            best = {"corr": r, "lag": lag, "overlap": int(len(x))}
    return best


def consecutive_similarity(embs: np.ndarray) -> float:
    """Mean cosine between consecutive items (the shots of a film): how well a look and its subject carry across cuts."""
    e = l2norm(np.atleast_2d(embs))
    if len(e) < 2:
        return float("nan")
    return float(np.mean(np.sum(e[1:] * e[:-1], axis=1)))
