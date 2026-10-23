"""What each metric means and which model (at which pinned revision, under which licence) makes it.
scripts/eval/lib/metric-info.mjs holds the same directions for compare and the reports."""

# The suite names a metric family; each family writes these keys per job.
FAMILIES = {
    "clip": ["clip"],
    "aesthetic": ["aesthetic"],
    "style": ["style", "styleNearest"],
    "identity": ["identity", "faceRate"],
    "temporal": ["drift", "driftMax", "warp"],
    "lipsync": ["lipsync", "lipsyncOffset"],
    "continuity": ["continuity"],
}

METRICS = {
    "clip": {"label": "CLIP prompt adherence", "better": "higher", "unit": "CLIPScore 0–100"},
    "aesthetic": {"label": "Aesthetic (LAION v2)", "better": "higher", "unit": "1–10"},
    "style": {"label": "Style vs references", "better": "higher", "unit": "cosine to the reference centroid"},
    "styleNearest": {"label": "Style, nearest reference", "better": "higher", "unit": "cosine"},
    "identity": {"label": "Identity vs references", "better": "higher", "unit": "face-embedding cosine"},
    "faceRate": {"label": "Frames with a face", "better": "higher", "unit": "0–1"},
    "drift": {"label": "Frame-to-frame drift", "better": "lower", "unit": "1 − cosine"},
    "driftMax": {"label": "Worst frame jump", "better": "lower", "unit": "1 − cosine"},
    "warp": {"label": "Warp error (flicker)", "better": "lower", "unit": "mean abs error 0–1"},
    "lipsync": {"label": "Lip-sync proxy", "better": "higher", "unit": "Pearson r, mouth motion vs voice"},
    "lipsyncOffset": {"label": "A/V offset", "better": "none", "unit": "frames"},
    "syncnet": {"label": "SyncNet confidence", "better": "higher", "unit": "SyncNet conf"},
    "continuity": {"label": "Shot continuity", "better": "higher", "unit": "cosine between consecutive shots"},
}

# Weights, each pinned to a Hugging Face revision. "commercial" says whether the model itself may be used
# commercially; a metric model only scores outputs, but the licence is recorded with every result.
MODELS = {
    "clip-b32": {
        "arch": "ViT-B-32",
        "repo": "laion/CLIP-ViT-B-32-laion2B-s34B-b79K",
        "file": "open_clip_model.safetensors",
        "revision": "1a25a446712ba5ee05982a381eed697ef9b435cf",
        "licence": "MIT",
        "commercial": True,
    },
    "clip-l14": {
        "arch": "ViT-L-14-quickgelu",
        "repo": "timm/vit_large_patch14_clip_224.openai",
        "file": "open_clip_model.safetensors",
        "revision": "18d0535469bb561bf468d76c1d73aa35156c922b",
        "licence": "MIT (OpenAI CLIP)",
        "commercial": True,
    },
    "aesthetic-v2": {
        "repo": "camenduru/improved-aesthetic-predictor",
        "file": "sac+logos+ava1-l14-linearMSE.pth",
        "revision": "7b2449be1264fcd9a1cf92e3d30dd29af989c836",
        "licence": "Apache-2.0 (christophschuhmann/improved-aesthetic-predictor; a mirror of the original weights)",
        "commercial": True,
    },
    "auraface": {
        "repo": "fal/AuraFace-v1",
        "files": ["glintr100.onnx", "scrfd_10g_bnkps.onnx"],
        "revision": "af6d057c9b0ec4071d4c49c80e3539258798b609",
        "licence": "Apache-2.0 (fal/AuraFace-v1, trained on commercially usable data; ships an SCRFD detector)",
        "commercial": True,
    },
    "buffalo_l": {
        "repo": "insightface model zoo (downloaded by insightface)",
        "licence": "non-commercial research only (insightface model packs)",
        "commercial": False,
    },
    "dinov2-small": {
        "repo": "facebook/dinov2-small",
        "licence": "Apache-2.0",
        "commercial": True,
    },
}
