#!/usr/bin/env python3
"""
Generate src/lib/catalog/higgsfield-models.generated.ts from docs/research/higgsfield-api.json.

Two outputs:
  HIGGSFIELD_MODELS — models only Higgsfield hosts (Soul, Soul Cinema, Genjutsu, Cinema Studio,
                      Marketing/Ads Studio, Grok Imagine, Happy Horse)
  HIGGSFIELD_ROUTES — extra `higgsfield` routes for models Fuobe already offers through fal /
                      Replicate (Seedance, Kling, Wan, MiniMax, LTX, PixVerse…), so a Higgsfield
                      key alone can run them.

Field names, enums, defaults and prices come from the verified research file; nothing is typed
by hand except the curated list below.

Run:  python3 scripts/gen-higgsfield-models.py
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RESEARCH = json.loads((ROOT / "docs/research/higgsfield-api.json").read_text())
EPS = {e["path"].lstrip("/"): e for e in RESEARCH["endpoints"] if e["method"] == "POST"}
RATIO = re.compile(r"^\d+(\.\d+)?:\d+(\.\d+)?$")
NICE_DURATIONS = [3, 4, 5, 6, 8, 10, 12, 15, 20, 30]


def warn(msg):
    print(f"warning: {msg}")


# Director-style enum fields exposed as composer controls.
CONTROL_LABELS = {
    "genre": "Genre", "era": "Era", "light": "Lighting", "pacing": "Pacing", "camera_model": "Camera",
    "camera_lens": "Lens", "camera_aperture": "Aperture", "camera_movement": "Camera move",
    "color_palette": "Color grade", "bitrate_mode": "Bitrate", "character_orientation": "Orientation",
    "quality": "Detail", "rendering_speed": "Speed", "shot_type": "Shot type",
}


def field_map(op, ep, inputs, opts):
    fm = {}
    if "prompt" not in inputs:
        fm["prompt"] = False
    pick = lambda *names: next((n for n in names if n in inputs), None)  # noqa: E731
    img = pick("image_url", "first_frame_url")
    imgs = "image_urls" if "image_urls" in inputs else None
    if op in ("t2i", "t2v"):
        img = imgs = None  # same endpoint may also serve edit/ref2v; keep text-only routes clean
    if img:
        fm["image"] = img
    if imgs:
        fm["images"] = imgs
    end = pick("end_image_url", "last_image_url", "last_frame_url")
    if end and op in ("i2v", "flf2v"):
        fm["endImage"] = end
        opts["endFrame"] = True
    clips = op not in ("t2i", "t2v", "i2v", "flf2v")  # text/frame routes stay clean, as with image_urls
    if "video_url" in inputs:
        fm["video"] = "video_url"
        # Seedance 2.5 edit / extend take reference clips beside the video they work on.
        if "video_urls" in inputs and clips:
            fm["videos"] = "video_urls"
    elif "video_urls" in inputs and op in ("v2v", "extend"):
        fm["videoArray"] = "video_urls"
    elif "video_urls" in inputs and clips:
        # Reference videos (Cinema Studio 4.0, Seedance, Wan, MiniMax reference-to-video): inputs.videos.
        fm["videos"] = "video_urls"
    if "audio_urls" in inputs and clips:
        fm["audios"] = "audio_urls"
    for field, key, canon in (("video_urls", "maxVideos", "videos"), ("audio_urls", "maxAudios", "audios")):
        if fm.get(canon) == field:
            opts[key] = max(opts.get(key, 0), int(inputs[field].get("maxItems") or 3))
    if "audio_url" in inputs and inputs["audio_url"].get("required"):
        fm["audio"] = "audio_url"
    if "negative_prompt" in inputs:
        fm["negativePrompt"] = "negative_prompt"
        opts["negativePrompt"] = True
    # Recraft's palette on Higgsfield: colors [{rgb: [r, g, b]}] and background_color {rgb: [r, g, b]} (Soul HEX).
    colors = (inputs.get("colors") or {}).get("items") or {}
    if "rgb" in (colors.get("fields") or {}):
        fm["palette"] = {"key": "colors", "format": "rgb-array"}
        if "rgb" in ((inputs.get("background_color") or {}).get("fields") or {}):
            fm["palette"]["background"] = "background_color"
    if "seed" in inputs:
        fm["seed"] = "seed"
        opts["seed"] = True
        lo, hi = inputs["seed"].get("min"), inputs["seed"].get("max")
        if hi is not None and hi < 2**31 - 1:
            fm["seedRange"] = [lo or 0, hi]
    if "aspect_ratio" in inputs:
        fm["aspectRatio"] = "aspect_ratio"
        vals = [v for v in inputs["aspect_ratio"].get("enum", []) if RATIO.match(str(v)) or v == "auto"]
        if vals:
            opts["aspectRatios"] = union(opts.get("aspectRatios", []), vals)
    if "resolution" in inputs:
        fm["resolution"] = "resolution"
        opts["resolutions"] = union(opts.get("resolutions", []), [str(v) for v in inputs["resolution"].get("enum", [])])
    if "duration" in inputs:
        d = inputs["duration"]
        fm["duration"] = {"key": "duration", "type": "number" if d.get("type") in ("integer", "number") else "string"}
        if d.get("enum"):
            vals = [v for v in d["enum"] if isinstance(v, (int, float))]
        else:
            lo, hi = d.get("min", 5), d.get("max", 5)
            vals = [v for v in NICE_DURATIONS if lo <= v <= hi] or [lo]
        opts["durations"] = union(opts.get("durations", []), vals)
    if "generate_audio" in inputs:
        fm["generateAudio"] = "generate_audio"
        opts["audio"] = True
    elif "sound" in inputs and inputs["sound"].get("enum") == ["on", "off"]:
        fm["generateAudio"] = {"key": "sound", "on": "on", "off": "off"}
        opts["audio"] = True
    if "multi_prompt" in inputs and op in ("t2v", "i2v", "flf2v", "ref2v"):
        item = (inputs["multi_prompt"].get("items") or {}).get("fields") or {}
        dtype = "number" if (item.get("duration") or {}).get("type") in ("integer", "number") else "string"
        fm["multiShot"] = {"key": "multi_prompt", "durationType": dtype, **({"flag": "multi_shots"} if "multi_shots" in inputs else {})}
        opts["multiShot"] = {"mode": "native", "maxShots": int(inputs["multi_prompt"].get("maxItems", 6))}
    if "batch_size" in inputs:
        b = inputs["batch_size"]
        if b.get("enum"):
            pass  # 1|4 only: Fuobe runs one job per image instead of an invalid batch of 2–3
        else:
            fm["numOutputs"] = "batch_size"
            opts["maxOutputs"] = max(opts.get("maxOutputs", 1), min(4, int(b.get("max", 4))))
    if imgs:
        opts["maxImages"] = max(opts.get("maxImages", 1), int(inputs["image_urls"].get("maxItems", 4)))
    elif img:
        opts["maxImages"] = max(opts.get("maxImages", 0), 1)
    controls = opts.setdefault("controls", [])
    for k, label in CONTROL_LABELS.items():
        spec = inputs.get(k)
        if not spec or not spec.get("enum") or any(c["param"] == k for c in controls):
            continue
        controls.append({"param": k, "label": label, "values": spec["enum"], **({"default": spec["default"]} if "default" in spec else {})})
    if not controls:
        del opts["controls"]
    return fm


def union(a, b):
    out = list(a)
    for x in b:
        if x not in out:
            out.append(x)
    return out


def price(ep, default_res=None):
    p = EPS[ep].get("priceUsd") or {}
    tiers = p.get("tiers") or []
    if not tiers or p.get("unit") not in ("image", "second", "video", "request"):
        return None
    t = next((t for t in tiers if default_res and t.get("resolution") == default_res), tiers[0])
    usd = t.get("listUsd")
    return {"unit": p["unit"], "usd": usd, "note": "Higgsfield list price"} if usd else None


def routes_for(spec, opts):
    out = []
    for r in spec:
        op, ep = r[0], r[1]
        if ep not in EPS:
            warn(f"{ep} not in research")
            continue
        e = EPS[ep]
        if not e.get("verified"):
            warn(f"{ep} not verified")
        fm = field_map(op, ep, e.get("inputs") or {}, opts)
        out.append({"op": op, "provider": "higgsfield", "endpoint": ep, "map": fm})
        if op == "i2v" and "endImage" in fm:
            out.append({"op": "flf2v", "provider": "higgsfield", "endpoint": ep, "map": fm})
    return out


# ---------------------------------------------------------------------------
# Higgsfield-only models

EXCLUSIVE = [
    dict(id="soul-2", name="Higgsfield Soul 2.0", vendor="Higgsfield", family="soul", kind="image",
         tagline="Higgsfield's fashion-grade photo model — real skin, real light, 100+ styles",
         badges=["top", "new"], routes=[("t2i", "higgsfield-ai/soul/v2/standard"), ("edit", "higgsfield-ai/soul/v2/image-to-image")],
         presets={"source": "soul-v2", "param": "style_id", "label": "Style"}, identity="v2",
         defaults={"aspectRatio": "3:4", "resolution": "1080p"}),
    dict(id="soul-cinema", name="Higgsfield Soul Cinema", vendor="Higgsfield", family="soul", kind="image",
         tagline="Cinematic stills with film-set lighting and composition",
         badges=["new"], routes=[("t2i", "higgsfield-ai/soul/cinema")], identity="cinema",
         defaults={"aspectRatio": "16:9", "resolution": "1080p"}),
    dict(id="soul-1", name="Higgsfield Soul", vendor="Higgsfield", family="soul", kind="image",
         tagline="The original Soul look with the full style library",
         routes=[("t2i", "higgsfield-ai/soul/standard")], presets={"source": "soul-v1", "param": "style_id", "label": "Style"}, identity="v1",
         defaults={"aspectRatio": "3:4", "resolution": "720p"}),
    dict(id="marketing-studio-image", name="Marketing Studio Image", vendor="Higgsfield", family="marketing-studio", kind="image",
         tagline="Ad-ready product shots and posters from a product photo and a template",
         routes=[("t2i", "marketing-studio/image"), ("edit", "marketing-studio/image")],
         presets={"source": "marketing-studio", "param": "preset_id", "label": "Template"}, defaults={"aspectRatio": "auto", "resolution": "2k"}),
    dict(id="ads-studio", name="Ads Studio", vendor="Higgsfield", family="ads-studio", kind="image",
         tagline="A brief and a product photo in, a batch of static ad concepts out",
         routes=[("t2i", "higgsfield/ads-studio/v1.0"), ("edit", "higgsfield/ads-studio/v1.0")], defaults={"aspectRatio": "1:1"}),
    dict(id="grok-imagine-image-2", name="Grok Imagine Image 2.0", vendor="xAI", family="grok", kind="image",
         tagline="xAI's image model — bold, fast, few refusals",
         routes=[("t2i", "xai/grok-imagine-image-2.0"), ("edit", "xai/grok-imagine-image-2.0")], defaults={"aspectRatio": "1:1"}),
    dict(id="cinema-studio-4", name="Cinema Studio 4.0", vendor="Higgsfield", family="cinema-studio", kind="video",
         tagline="Higgsfield's director model on Seedance 2.5 — genre, lens, light, grade and camera move controls",
         badges=["top", "audio", "new"], routes=[("t2v", "higgsfield/cinema-studio/4.0"), ("ref2v", "higgsfield/cinema-studio/4.0")],
         defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "720p"}),
    dict(id="genjutsu-motion-transfer", name="Genjutsu Motion Transfer", vendor="Higgsfield", family="genjutsu", kind="video",
         tagline="Keep a clip's motion, swap in your characters and world",
         badges=["new"], routes=[("motion-transfer", "higgsfield/genjutsu/motion-transfer/v1.0")], defaults={"resolution": "720p"}),
    dict(id="genjutsu-object-swap", name="Genjutsu Object Swap", vendor="Higgsfield", family="genjutsu", kind="video",
         tagline="Replace one thing in a video and keep everything else",
         routes=[("v2v", "higgsfield/genjutsu/object-swap/v1.0")], defaults={"resolution": "720p"}),
    dict(id="genjutsu-restyle", name="Genjutsu Restyle", vendor="Higgsfield", family="genjutsu", kind="video",
         tagline="Restyle footage with 30+ looks while keeping motion and audio",
         routes=[("v2v", "higgsfield/genjutsu/restyle/v1.0")],
         presets={"source": "genjutsu-restyle", "param": "preset_id", "label": "Style", "required": True}, defaults={"resolution": "720p"}),
    dict(id="grok-imagine-video-1-5", name="Grok Imagine Video 1.5", vendor="xAI", family="grok", kind="video",
         tagline="xAI's video model with references and audio",
         routes=[("t2v", "xai/grok-imagine-video/v1.5/reference-to-video"), ("i2v", "xai/grok-imagine-video/v1.5/reference-to-video"),
                 ("ref2v", "xai/grok-imagine-video/v1.5/reference-to-video")], defaults={"aspectRatio": "16:9", "duration": 6}),
    dict(id="happy-horse-1-1", name="Happy Horse 1.1", vendor="Alibaba", family="happy-horse", kind="video",
         tagline="Alibaba's expressive character-animation video model",
         routes=[("t2v", "alibaba/happy-horse/v1.1/text-to-video"), ("i2v", "alibaba/happy-horse/v1.1/image-to-video"),
                 ("ref2v", "alibaba/happy-horse/v1.1/reference-to-video")], defaults={"aspectRatio": "16:9", "duration": 5}),
]

# Existing Fuobe models that Higgsfield also hosts.
EXTRA = {
    "seedance-2-5": [("t2v", "bytedance/seedance-2.5/text-to-video"), ("i2v", "bytedance/seedance-2.5/image-to-video"),
                     ("ref2v", "bytedance/seedance-2.5/reference-to-video"), ("v2v", "bytedance/seedance-2.5/video-edit"),
                     ("extend", "bytedance/seedance-2.5/video-extend")],
    "seedance-2-0": [("t2v", "bytedance/seedance-2.0/text-to-video"), ("i2v", "bytedance/seedance-2.0/image-to-video"),
                     ("ref2v", "bytedance/seedance-2.0/reference-to-video")],
    "kling-3": [("t2v", "kling-video/v3.0/pro/text-to-video"), ("i2v", "kling-video/v3.0/pro/image-to-video")],
    "kling-3-4k": [("t2v", "kling-video/v3.0/4k/text-to-video"), ("i2v", "kling-video/v3.0/4k/image-to-video")],
    "kling-3-turbo": [("t2v", "kling-video/v3.0-turbo/text-to-video"), ("i2v", "kling-video/v3.0-turbo/image-to-video")],
    "kling-o3": [("flf2v", "kling-video/o3/first-last-frame"), ("ref2v", "kling-video/o3/image-reference"), ("v2v", "kling-video/o3/video-edit")],
    "kling-o1": [("flf2v", "kling-video/omni/first-last-frame"), ("ref2v", "kling-video/omni/image-reference"), ("v2v", "kling-video/omni/video-edit")],
    "kling-motion-control": [("motion-transfer", "kling-video/v3/motion-control/pro")],
    "kling-2-6-pro": [("t2v", "kling-video/v2.6/pro/text-to-video"), ("i2v", "kling-video/v2.6/pro/image-to-video")],
    "kling-2-5-turbo": [("t2v", "kling-video/v2.5-turbo/pro/text-to-video"), ("i2v", "kling-video/v2.5-turbo/pro/image-to-video")],
    "minimax-h3": [("t2v", "minimax/h3/text-to-video"), ("i2v", "minimax/h3/image-to-video"), ("ref2v", "minimax/h3/reference-to-video")],
    "hailuo-2-3": [("t2v", "minimax/hailuo-2.3/standard/text-to-video"), ("i2v", "minimax/hailuo-2.3/standard/image-to-video")],
    "ltx-2-5": [("t2v", "lightricks/ltx-2.5/text-to-video/pro"), ("i2v", "lightricks/ltx-2.5/image-to-video/pro")],
    "pixverse-v6": [("t2v", "pixverse/v6/text-to-video"), ("i2v", "pixverse/v6/image-to-video")],
    "wan-3": [("t2v", "alibaba/wan-3.0/text-to-video"), ("i2v", "alibaba/wan-3.0/image-to-video"), ("ref2v", "alibaba/wan-3.0/reference-to-video")],
    "wan-3-prime": [("t2v", "alibaba/wan-3.0-prime/text-to-video"), ("i2v", "alibaba/wan-3.0-prime/image-to-video"),
                    ("ref2v", "alibaba/wan-3.0-prime/reference-to-video")],
    "wan-2-7": [("t2v", "wan/v2.7/text-to-video"), ("i2v", "wan/v2.7/image-to-video"), ("ref2v", "wan/v2.7/reference-to-video")],
    "wan-2-6": [("t2v", "wan/v2.6/text-to-video"), ("i2v", "wan/v2.6/image-to-video")],
    "qwen-image-3": [("t2i", "alibaba/qwen-image-3/text-to-image"), ("edit", "alibaba/qwen-image-3/edit")],
    "z-image-turbo-cloud": [("t2i", "z-image/turbo")],
    "recraft-4-1": [("t2i", "recraft/v4.1/text-to-image")],
    "recraft-4-1-pro": [("t2i", "recraft/v4.1/pro/text-to-image")],
}

models = []
for m in EXCLUSIVE:
    opts = {}
    routes = routes_for(m["routes"], opts)
    if not routes:
        continue
    if m.get("presets"):
        opts["presets"] = m["presets"]
    d = {
        "id": m["id"], "name": m["name"], "vendor": m["vendor"], "family": m["family"], "engine": "cloud", "kind": m["kind"],
        "tagline": m["tagline"], "badges": m.get("badges", []), "routes": routes, "options": opts, "defaults": m.get("defaults", {}),
    }
    if m.get("identity"):
        d["identity"] = {"provider": "higgsfield", "version": m["identity"]}
    p = price(m["routes"][0][1], m.get("defaults", {}).get("resolution"))
    if p:
        d["pricing"] = p
    models.append(d)

extra = {}
for mid, spec in EXTRA.items():
    opts = {}
    # The model keeps its own enums and controls: Higgsfield-only fields would break its fal routes.
    extra[mid] = routes_for(spec, opts)

out = ROOT / "src/lib/catalog/higgsfield-models.generated.ts"
out.write_text(
    "// GENERATED by scripts/gen-higgsfield-models.py from docs/research/higgsfield-api.json — do not edit.\n"
    'import type { ModelDef, ModelRoute } from "./types";\n\n'
    f"export const HIGGSFIELD_MODELS: ModelDef[] = {json.dumps(models, indent=2, ensure_ascii=False)};\n\n"
    f"export const HIGGSFIELD_ROUTES: Record<string, ModelRoute[]> = {json.dumps(extra, indent=2, ensure_ascii=False)};\n"
)
print(f"wrote {len(models)} Higgsfield models and {sum(len(v) for v in extra.values())} extra routes for {len(extra)} models")
