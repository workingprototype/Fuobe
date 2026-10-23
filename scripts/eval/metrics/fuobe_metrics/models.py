"""The models behind the metrics, loaded once and only when a metric needs them. Weights come from
Hugging Face at the revisions pinned in registry.py, into FUOBE_EVAL_CACHE (default
~/.cache/fuobe-eval). Everything runs on the CPU unless --device says otherwise."""

from __future__ import annotations

import os
import pathlib

import numpy as np

from .registry import MODELS

CACHE = pathlib.Path(os.environ.get("FUOBE_EVAL_CACHE", pathlib.Path.home() / ".cache" / "fuobe-eval"))


class Missing(RuntimeError):
    """A metric's library or weights aren't installed; the message says how to get them."""


def _torch():
    try:
        import torch  # noqa: PLC0415
    except ImportError as e:
        raise Missing("PyTorch isn't installed: run pnpm eval:setup") from e
    return torch


def device_of(want: str = "cpu") -> str:
    if want == "auto":
        torch = _torch()
        return "cuda" if torch.cuda.is_available() else "mps" if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available() else "cpu"
    return want


def _download(key: str, filename: str) -> str:
    try:
        from huggingface_hub import hf_hub_download  # noqa: PLC0415
    except ImportError as e:
        raise Missing("huggingface_hub isn't installed: run pnpm eval:setup") from e
    m = MODELS[key]
    return hf_hub_download(m["repo"], filename, revision=m["revision"], cache_dir=str(CACHE / "hf"))


class Clip:
    """open_clip image and text embeddings (L2-normalised numpy)."""

    def __init__(self, key: str = "clip-b32", device: str = "cpu"):
        try:
            import open_clip  # noqa: PLC0415
        except ImportError as e:
            raise Missing("open_clip isn't installed: run pnpm eval:setup") from e
        torch = _torch()
        m = MODELS[key]
        weights = _download(key, m["file"])
        self.key = key
        self.device = device
        self.model, _, self.preprocess = open_clip.create_model_and_transforms(m["arch"], pretrained=weights, device=device)
        self.model.eval()
        self.tokenizer = open_clip.get_tokenizer(m["arch"])
        self.torch = torch

    def images(self, pictures) -> np.ndarray:
        if not pictures:
            return np.zeros((0, 1))
        with self.torch.no_grad():
            out = []
            for i in range(0, len(pictures), 16):
                batch = self.torch.stack([self.preprocess(p) for p in pictures[i : i + 16]]).to(self.device)
                e = self.model.encode_image(batch)
                out.append(self.torch.nn.functional.normalize(e, dim=-1).float().cpu().numpy())
        return np.concatenate(out)

    def texts(self, texts: list[str]) -> np.ndarray:
        with self.torch.no_grad():
            tokens = self.tokenizer(texts).to(self.device)
            e = self.model.encode_text(tokens)
            return self.torch.nn.functional.normalize(e, dim=-1).float().cpu().numpy()


class Aesthetic:
    """The LAION improved aesthetic predictor (v2, sac+logos+ava1 linear MSE) on CLIP ViT-L/14 embeddings: about 1–10."""

    def __init__(self, clip_l14: Clip):
        torch = clip_l14.torch
        nn = torch.nn
        self.clip = clip_l14
        self.head = nn.Sequential(
            nn.Linear(768, 1024),
            nn.Dropout(0.2),
            nn.Linear(1024, 128),
            nn.Dropout(0.2),
            nn.Linear(128, 64),
            nn.Dropout(0.1),
            nn.Linear(64, 16),
            nn.Linear(16, 1),
        )
        state = torch.load(_download("aesthetic-v2", MODELS["aesthetic-v2"]["file"]), map_location="cpu", weights_only=True)
        # The original checkpoint names the Sequential "layers".
        self.head.load_state_dict({k.removeprefix("layers."): v for k, v in state.items()})
        self.head.eval().to(clip_l14.device)

    def scores(self, pictures) -> np.ndarray:
        emb = self.clip.images(pictures)
        with self.clip.torch.no_grad():
            t = self.clip.torch.from_numpy(emb).to(self.clip.device)
            return self.head(t).squeeze(-1).float().cpu().numpy()


class Faces:
    """Face detection + ArcFace-style embeddings through insightface. AuraFace (Apache-2.0) by default; buffalo_l is opt-in."""

    def __init__(self, name: str = "auraface", device: str = "cpu"):
        try:
            from insightface.app import FaceAnalysis  # noqa: PLC0415
        except ImportError as e:
            raise Missing("insightface isn't installed: run pnpm eval:setup --identity") from e
        providers = ["CUDAExecutionProvider", "CPUExecutionProvider"] if device == "cuda" else ["CPUExecutionProvider"]
        root = CACHE / "insightface"
        if name == "auraface":
            folder = root / "models" / "auraface"
            folder.mkdir(parents=True, exist_ok=True)
            for f in MODELS["auraface"]["files"]:
                target = folder / f
                if not target.exists():
                    target.symlink_to(_download("auraface", f))
        self.name = name
        self.app = FaceAnalysis(name=name, root=str(root), providers=providers, allowed_modules=["detection", "recognition"])
        self.app.prepare(ctx_id=0 if device == "cuda" else -1, det_size=(640, 640))

    def largest(self, picture) -> dict | None:
        """The largest face in a PIL picture: {embedding, box} or None."""
        bgr = np.asarray(picture.convert("RGB"))[:, :, ::-1]
        faces = self.app.get(bgr)
        if not faces:
            return None
        f = max(faces, key=lambda x: float((x.bbox[2] - x.bbox[0]) * (x.bbox[3] - x.bbox[1])))
        return {"embedding": np.asarray(f.normed_embedding, dtype=np.float64), "box": [float(v) for v in f.bbox]}
