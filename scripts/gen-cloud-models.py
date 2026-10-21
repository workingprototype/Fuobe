#!/usr/bin/env python3
"""
Generate src/lib/catalog/cloud-models.generated.ts from docs/research/paid-model-apis.json
(merged with parts 2 and 3: paid-model-apis-2.json, paid-model-apis-3.json).

The research file holds verified fal/Replicate input schemas (field names, enums, defaults,
prices). This script turns a curated list of models (MODELS below, mirroring Higgsfield's
lineup) into ModelDef objects with correct FieldMaps, so no field name is typed by hand.

Run:  python3 scripts/gen-cloud-models.py
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RESEARCH = json.loads((ROOT / "docs/research/paid-model-apis.json").read_text())
EPS = {}
for e in RESEARCH["endpoints"]:
    EPS.setdefault((e["provider"], e["endpoint"]), e)
# Part 2 (multi-shot, draft, extend, reframe, audio, training) re-verified some endpoints with more key fields.
RESEARCH_2 = json.loads((ROOT / "docs/research/paid-model-apis-2.json").read_text())
for e in RESEARCH_2["endpoints"]:
    prev = EPS.get((e["provider"], e["endpoint"]))
    # Keep part 1's key fields (aspect ratio mappings etc.) and add part 2's.
    EPS[(e["provider"], e["endpoint"])] = {**e, "keyFields": {**((prev or {}).get("keyFields") or {}), **(e.get("keyFields") or {})}}
# Part 3 (layers, styles/palettes, restyle, video utilities, captions, transcription, SFX/music, 3D, try-on,
# product shots): same merge, so re-verified endpoints keep the key fields parts 1-2 recorded.
RESEARCH_3 = json.loads((ROOT / "docs/research/paid-model-apis-3.json").read_text())
for e in RESEARCH_3["endpoints"]:
    prev = EPS.get((e["provider"], e["endpoint"]))
    EPS[(e["provider"], e["endpoint"])] = {**e, "keyFields": {**((prev or {}).get("keyFields") or {}), **(e.get("keyFields") or {})}}

IMG_AR = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9", "5:4", "4:5"]
IMAGE_SIZE_MAP = {
    "1:1": "square_hd", "4:3": "landscape_4_3", "3:4": "portrait_4_3", "16:9": "landscape_16_9",
    "9:16": "portrait_16_9", "3:2": "landscape_4_3", "2:3": "portrait_4_3", "21:9": "landscape_16_9",
    "5:4": "landscape_4_3", "4:5": "portrait_4_3",
}
RATIO = re.compile(r"^\d+(\.\d+)?:\d+(\.\d+)?$")

# ---------------------------------------------------------------------------
# Curated catalog. routes: list of (op, endpoint) or (op, endpoint, provider).
# "+flf2v" on an i2v endpoint that accepts an end frame adds a start/end-frame route.

M = []


def model(id, name, vendor, family, kind, tagline, routes, badges=None, pricing=None, defaults=None, options=None, fixed=None, hidden=False,
          sliders=None, controls=None, api_defaults=None):
    """sliders / controls: [(field, label)] read from each route's research inputs (dotted = nested field):
    numeric fields with minimum/maximum become sliders, enums become composer controls; both travel as params.extra.
    fixed: fields always sent. api_defaults: fields sent unless the request sets them (FieldMap.defaults)."""
    M.append(dict(id=id, name=name, vendor=vendor, family=family, kind=kind, tagline=tagline, routes=routes,
                  badges=badges or [], pricing=pricing, defaults=defaults or {}, options=options or {}, fixed=fixed or {}, hidden=hidden,
                  sliders=sliders or [], controls=controls or [], api_defaults=api_defaults or {}))


# ----- Image
model("nano-banana-pro", "Nano Banana Pro", "Google", "gemini-image", "image",
      "Gemini 3 Pro Image — best text rendering, reasoning and multi-reference edits up to 4K",
      [("t2i", "fal-ai/nano-banana-pro"), ("edit", "fal-ai/nano-banana-pro/edit"),
       ("t2i", "google/nano-banana-pro", "replicate"), ("edit", "google/nano-banana-pro", "replicate")],
      badges=["top", "4k"], pricing=("image", 0.15, "4K is 2x"), defaults={"aspectRatio": "1:1", "resolution": "1K"})
model("nano-banana-2", "Nano Banana 2", "Google", "gemini-image", "image",
      "Newest Gemini image model — sharper detail, 0.5K–4K, up to 14 references",
      [("t2i", "fal-ai/nano-banana-2"), ("edit", "fal-ai/nano-banana-2/edit")],
      badges=["new", "4k"], pricing=("image", 0.08, "2K 1.5x, 4K 2x"), defaults={"aspectRatio": "1:1", "resolution": "1K"})
model("nano-banana-2-1", "Nano Banana 2.1", "Google", "gemini-image", "image",
      "Gemini 2.1 image with thinking — strongest instruction following",
      [("t2i", "google/nano-banana-2.1"), ("edit", "google/nano-banana-2.1/edit")],
      badges=["new"], pricing=("image", 0.1, "token-based, approx."), defaults={"aspectRatio": "1:1", "resolution": "1K"})
model("nano-banana", "Nano Banana", "Google", "gemini-image", "image",
      "Gemini 2.5 Flash Image — fast, cheap, great at consistent edits",
      [("t2i", "fal-ai/nano-banana"), ("edit", "fal-ai/nano-banana/edit"),
       ("t2i", "google/nano-banana", "replicate"), ("edit", "google/nano-banana", "replicate")],
      badges=["fast"], pricing=("image", 0.039), defaults={"aspectRatio": "1:1"})
model("seedream-5-pro", "Seedream 5.0 Pro", "ByteDance", "seedream", "image",
      "ByteDance's flagship — photoreal 4K with multi-image editing",
      [("t2i", "bytedance/seedream/v5/pro/text-to-image"), ("edit", "bytedance/seedream/v5/pro/edit")],
      badges=["new", "4k"], defaults={"aspectRatio": "3:4"})
model("seedream-5-lite", "Seedream 5.0 Lite", "ByteDance", "seedream", "image",
      "Fast, affordable Seedream 5",
      [("t2i", "bytedance/seedream/v5/lite/text-to-image"), ("edit", "bytedance/seedream/v5/lite/edit")],
      badges=["fast"], defaults={"aspectRatio": "3:4"})
model("seedream-4-5", "Seedream 4.5", "ByteDance", "seedream", "image",
      "Photoreal 4K generation and multi-image editing",
      [("t2i", "fal-ai/bytedance/seedream/v4.5/text-to-image"), ("edit", "fal-ai/bytedance/seedream/v4.5/edit")],
      pricing=("image", 0.04), defaults={"aspectRatio": "3:4"})
model("gpt-image-2-5", "GPT Image 2.5 Flare", "OpenAI", "gpt-image", "image",
      "OpenAI's latest — precise layouts, text and instruction edits",
      [("t2i", "openai/gpt-image-2.5/flare/text-to-image"), ("edit", "openai/gpt-image-2.5/flare/edit")],
      badges=["new"], defaults={"aspectRatio": "1:1"})
model("gpt-image-2-5-sunburst", "GPT Image 2.5 Sunburst", "OpenAI", "gpt-image", "image",
      "Warmer, more stylized GPT Image 2.5 variant",
      [("t2i", "openai/gpt-image-2.5/sunburst/text-to-image"), ("edit", "openai/gpt-image-2.5/sunburst/edit")],
      defaults={"aspectRatio": "1:1"})
model("gpt-image-2", "GPT Image 2", "OpenAI", "gpt-image", "image",
      "Reliable prompt following, text and graphic design",
      [("t2i", "openai/gpt-image-2"), ("edit", "openai/gpt-image-2/edit")], defaults={"aspectRatio": "1:1"})
model("gpt-image-1-5", "GPT Image 1.5", "OpenAI", "gpt-image", "image",
      "Strong prompt following, text and layout",
      [("t2i", "fal-ai/gpt-image-1.5"), ("edit", "fal-ai/gpt-image-1.5/edit")],
      pricing=("image", 0.13, "high quality"), fixed={"quality": "high"}, defaults={"aspectRatio": "1:1"})
model("flux-3", "FLUX.3", "Black Forest Labs", "flux", "image",
      "BFL's newest image model with unified generation and editing",
      [("t2i", "blackforestlabs/flux-3/text-to-image"), ("edit", "blackforestlabs/flux-3/edit-image")],
      badges=["new"], defaults={"aspectRatio": "1:1"})
model("flux-2-pro", "FLUX.2 [pro]", "Black Forest Labs", "flux", "image",
      "Production-grade photorealism with multi-reference editing",
      [("t2i", "fal-ai/flux-2-pro"), ("edit", "fal-ai/flux-2-pro/edit")],
      pricing=("megapixel", 0.03), defaults={"aspectRatio": "1:1"})
model("flux-kontext-max", "FLUX.1 Kontext [max]", "Black Forest Labs", "flux", "image",
      "Precise local edits that keep everything else intact",
      [("t2i", "fal-ai/flux-pro/kontext/max/text-to-image"), ("edit", "fal-ai/flux-pro/kontext/max")],
      pricing=("image", 0.08), defaults={"aspectRatio": "1:1"})
model("ideogram-4-5", "Ideogram 4.5", "Ideogram", "ideogram", "image",
      "Best-in-class typography, posters and graphic design",
      [("t2i", "ideogram/v4.5"), ("edit", "ideogram/v4.5/edit")], defaults={"aspectRatio": "1:1"})
model("flux-fill-pro", "FLUX.1 Fill [pro]", "Black Forest Labs", "flux", "image", "Precise inpainting and object replacement with a mask",
      [("inpaint", "fal-ai/flux-pro/v1/fill")], pricing=("megapixel", 0.05), hidden=False)
model("z-image-inpaint", "Z-Image Turbo Inpaint (hosted)", "Alibaba Tongyi", "z-image", "image", "Cheapest, fastest masked inpainting",
      [("inpaint", "fal-ai/z-image/turbo/inpaint")], badges=["fast"], pricing=("megapixel", 0.01))
model("recraft-4-1", "Recraft V4.1", "Recraft", "recraft", "image",
      "Brand-ready illustration, icons and design assets in your colour palette",
      [("t2i", "fal-ai/recraft/v4.1/text-to-image")], defaults={"aspectRatio": "1:1"})
model("qwen-image-3", "Qwen Image 3", "Alibaba Qwen", "qwen-image", "image",
      "Hosted Qwen with superb bilingual text rendering",
      [("t2i", "alibaba/qwen-image-3/text-to-image"), ("edit", "alibaba/qwen-image-3/edit")], defaults={"aspectRatio": "1:1"})
model("wan-2-7-image", "Wan 2.7 Image", "Alibaba Wan", "wan", "image",
      "Wan's image model — cinematic stills that animate well",
      [("t2i", "fal-ai/wan/v2.7/pro/text-to-image"), ("edit", "fal-ai/wan/v2.7/pro/edit")], defaults={"aspectRatio": "16:9"})
model("z-image-turbo-cloud", "Z-Image Turbo (hosted)", "Alibaba Tongyi", "z-image", "image",
      "Sub-second photoreal images",
      [("t2i", "fal-ai/z-image/turbo", "fal", {"loraEndpoint": "fal-ai/z-image/turbo/lora"})], badges=["fast"], defaults={"aspectRatio": "1:1"})
model("imagen-4", "Imagen 4", "Google", "imagen", "image", "Google's photoreal text-to-image",
      [("t2i", "google/imagen-4", "replicate")], defaults={"aspectRatio": "1:1"})

# ----- Image: palettes, styles and references (research part 3; Soul HEX, Moodboards)
model("recraft-4-1-pro", "Recraft V4.1 Pro", "Recraft", "recraft", "image",
      "Recraft's top tier — 2K design-grade images in your exact palette",
      [("t2i", "fal-ai/recraft/v4.1/pro/text-to-image")], badges=["pro"], defaults={"aspectRatio": "1:1"})
# The style comes from 1-10 reference images (or a saved style_id): with neither the call fails, so these run as
# edits only. A text-to-image route can come back once something in Fuobe saves style ids (a moodboard element).
model("recraft-4-style", "Recraft V4 Styles", "Recraft", "recraft", "image",
      "A new picture in the style of 1–10 reference images",
      [("edit", "recraft/v4/style/text-to-image")],
      pricing=("image", 0.035, "+$0.005 when a new style is made from references"), defaults={"aspectRatio": "1:1"},
      controls=[("style_match", "Style match")])
model("recraft-4-style-pro", "Recraft V4 Styles Pro", "Recraft", "recraft", "image",
      "Recraft styles from your references, at Pro quality",
      [("edit", "recraft/v4/style/pro/text-to-image")],
      badges=["pro"], pricing=("image", 0.1, "+$0.005 when a new style is made from references"), defaults={"aspectRatio": "1:1"},
      controls=[("style_match", "Style match")])
model("ideogram-3", "Ideogram 3.0", "Ideogram", "ideogram", "image",
      "Posters and type in your exact brand colours, with 60+ style presets and style references",
      [("t2i", "fal-ai/ideogram/v3"),
       # Remix and edit take image_urls as style references: the picture being edited is not one of them.
       ("edit", "fal-ai/ideogram/v3/remix", "fal", {"drop": ["images", "styleImages"]}),
       ("inpaint", "fal-ai/ideogram/v3/edit", "fal", {"drop": ["images"]})],
      pricing=("image", 0.06, "Balanced; Turbo $0.03, Quality $0.09"), defaults={"aspectRatio": "1:1"},
      sliders=[("strength", "Remix strength")], controls=[("rendering_speed", "Speed"), ("style", "Style"), ("style_preset", "Preset")])
model("krea-2-style", "Krea 2 Style Reference", "Krea", "krea", "image",
      "Match the look of 1–3 reference images in a new picture, zero-shot",
      [("edit", "fal-ai/krea-2/turbo/style")], badges=["new", "fast"], defaults={"aspectRatio": "1:1"},
      sliders=[("style_scale", "Style strength")])
model("flux-redux-ultra", "FLUX1.1 [pro] Ultra Redux", "Black Forest Labs", "flux", "image",
      "Variations and remixes of an image, steered by a prompt, up to 4MP",
      [("edit", "fal-ai/flux-pro/v1.1-ultra/redux")], defaults={"aspectRatio": "1:1"},
      sliders=[("image_prompt_strength", "Reference strength")])
model("flux-redux-pro", "FLUX1.1 [pro] Redux", "Black Forest Labs", "flux", "image",
      "Image-prompted FLUX: keeps the reference's look while you change the scene",
      [("edit", "fal-ai/flux-pro/v1.1/redux")], defaults={"aspectRatio": "1:1"})

# ----- Image: characters, angles, try-on and product shots (research part 3)
model("instant-character", "Instant Character", "Tencent Hunyuan", "instant-character", "image",
      "One photo of a character, any new scene — no training",
      [("edit", "fal-ai/instant-character")], defaults={"aspectRatio": "1:1"}, sliders=[("scale", "Character strength")])
model("qwen-multiple-angles", "Qwen Multiple Angles", "Alibaba Qwen", "qwen-image", "image",
      "See the same shot from another angle: rotate, tilt and zoom the camera",
      [("edit", "fal-ai/qwen-image-edit-2511-multiple-angles")], badges=["new"],
      sliders=[("horizontal_angle", "Rotate (°)"), ("vertical_angle", "Tilt (°)"), ("zoom", "Zoom")])
model("fashn-tryon", "FASHN Try-On 1.6", "FASHN", "fashn", "image",
      "Put a garment on a person: model photo first, then the garment",
      [("edit", "fal-ai/fashn/tryon/v1.6")], badges=["top"],
      controls=[("category", "Garment"), ("mode", "Quality"), ("garment_photo_type", "Garment photo")])
model("google-try-on", "Google Virtual Try-On", "Google", "imagen", "image",
      "Google's try-on: a person photo and a product photo",
      [("edit", "google/virtual-try-on")], pricing=("image", 0.075))
# garment_type is required and has no API default: tops unless the Garment control says otherwise.
model("leffa-tryon", "Leffa Virtual Try-On", "Leffa", "leffa", "image",
      "Open-weights try-on for tops, bottoms and dresses",
      [("edit", "fal-ai/leffa/virtual-tryon")], api_defaults={"garment_type": "upper_body"}, controls=[("garment_type", "Garment")])
model("bria-product-shot", "Bria Product Shot", "Bria", "bria", "image",
      "Your product photo in a new scene — describe it or add a reference scene",
      [("edit", "fal-ai/bria/product-shot")], controls=[("placement_type", "Placement")])
model("product-photography", "Product Photography", "fal", "image-apps", "image",
      "One tap: a clean studio shot of your product",
      [("edit", "fal-ai/image-apps-v2/product-photography", "fal", {"drop": ["aspectRatio"]})])
model("bria-background-replace", "Bria Background Replace", "Bria", "bria", "image",
      "Keep the subject, swap the background for a prompt or a reference image",
      [("edit", "fal-ai/bria/background/replace")])
model("bria-extract-object", "Bria Extract Object", "Bria", "bria", "image",
      "Cut out one thing by name, e.g. “the red mug”",
      [("edit", "bria/extract-object")])

# ----- Video
model("seedance-2-5", "Seedance 2.5", "ByteDance", "seedance", "video",
      "Higgsfield's default — multi-shot cinema with native audio, up to 30s",
      [("t2v", "bytedance/seedance-2.5/text-to-video"), ("i2v", "bytedance/seedance-2.5/image-to-video", "fal", "+flf2v"),
       ("ref2v", "bytedance/seedance-2.5/reference-to-video"),
       ("extend", "bytedance/seedance-2.5/reference-to-video", "fal", {"fixed": {"task": "extension"}, "videoArray": True}),
       ("finalize", "bytedance/seedance-2.5/draft/complete")],
      badges=["top", "audio", "new"], pricing=("second", 0.473, "720p"), defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "720p"},
      # fal's schema gives no count for 2.5's reference clips; Higgsfield's and Replicate's 2.5 schemas say up to 10 (30 s in all).
      options={"multiShot": {"mode": "prompt", "maxShots": 6}, "maxVideos": 10, "maxAudios": 10})
model("seedance-2-0", "Seedance 2.0", "ByteDance", "seedance", "video",
      "Smooth multi-shot motion with audio",
      [("t2v", "bytedance/seedance-2.0/text-to-video"), ("i2v", "bytedance/seedance-2.0/image-to-video", "fal", "+flf2v"),
       ("ref2v", "bytedance/seedance-2.0/reference-to-video")],
      badges=["audio"], defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "720p"}, options={"multiShot": {"mode": "prompt", "maxShots": 6}})
model("seedance-2-0-fast", "Seedance 2.0 Fast", "ByteDance", "seedance", "video",
      "Seedance 2 at draft speed",
      [("t2v", "bytedance/seedance-2.0/fast/text-to-video"), ("i2v", "bytedance/seedance-2.0/fast/image-to-video", "fal", "+flf2v"),
       ("ref2v", "bytedance/seedance-2.0/fast/reference-to-video")],
      badges=["fast", "audio"], defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "720p"})
model("seedance-1-pro", "Seedance 1.0 Pro", "ByteDance", "seedance", "video",
      "Stable, physics-aware motion with start & end frames",
      [("t2v", "fal-ai/bytedance/seedance/v1/pro/text-to-video"), ("i2v", "fal-ai/bytedance/seedance/v1/pro/image-to-video", "fal", "+flf2v")],
      pricing=("second", 0.124, "1080p"), defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "1080p"})
model("kling-3", "Kling 3.0", "Kuaishou", "kling", "video",
      "Kling's flagship — multi-shot, native audio, up to 15s",
      [("t2v", "fal-ai/kling-video/v3/pro/text-to-video"), ("i2v", "fal-ai/kling-video/v3/pro/image-to-video", "fal", "+flf2v")],
      badges=["top", "audio", "new"], pricing=("second", 0.168, "audio on; audio-off-half"), defaults={"aspectRatio": "16:9", "duration": 5})
model("kling-3-turbo", "Kling 3.0 Turbo", "Kuaishou", "kling", "video",
      "Kling 3 quality, faster and cheaper",
      [("t2v", "fal-ai/kling-video/v3/turbo/pro/text-to-video"), ("i2v", "fal-ai/kling-video/v3/turbo/pro/image-to-video", "fal", "+flf2v")],
      badges=["fast", "audio"], defaults={"aspectRatio": "16:9", "duration": 5})
model("kling-3-4k", "Kling 3.0 4K", "Kuaishou", "kling", "video", "Native 4K Kling 3",
      [("t2v", "fal-ai/kling-video/v3/4k/text-to-video"), ("i2v", "fal-ai/kling-video/v3/4k/image-to-video", "fal", "+flf2v")],
      badges=["4k", "audio"], defaults={"aspectRatio": "16:9", "duration": 5})
model("kling-o3", "Kling O3 Omni", "Kuaishou", "kling", "video",
      "One model for text, image, reference and video edits",
      [("t2v", "fal-ai/kling-video/o3/pro/text-to-video"), ("i2v", "fal-ai/kling-video/o3/pro/image-to-video", "fal", "+flf2v"),
       ("ref2v", "fal-ai/kling-video/o3/pro/reference-to-video"), ("v2v", "fal-ai/kling-video/o3/pro/video-to-video/edit")],
      badges=["new"], defaults={"aspectRatio": "16:9", "duration": 5})
model("kling-o1", "Kling O1 Omni", "Kuaishou", "kling", "video",
      "Reference-driven video and natural-language video editing",
      [("i2v", "fal-ai/kling-video/o1/image-to-video", "fal", "+flf2v"), ("ref2v", "fal-ai/kling-video/o1/reference-to-video"),
       ("v2v", "fal-ai/kling-video/o1/video-to-video/edit")], defaults={"aspectRatio": "16:9", "duration": 5})
# character_orientation is required with no default: follow the driving video (the API's advice for complex motion).
model("kling-motion-control", "Kling 3.0 Motion Control", "Kuaishou", "kling", "video",
      "Copy the motion of a reference video onto your character",
      [("motion-transfer", "fal-ai/kling-video/v3/pro/motion-control")], defaults={},
      api_defaults={"character_orientation": "video"}, controls=[("character_orientation", "Facing")])
model("kling-2-6-pro", "Kling 2.6 Pro", "Kuaishou", "kling", "video",
      "Cinematic motion with native audio and dialogue",
      [("t2v", "fal-ai/kling-video/v2.6/pro/text-to-video"), ("i2v", "fal-ai/kling-video/v2.6/pro/image-to-video", "fal", "+flf2v")],
      badges=["audio"], pricing=("second", 0.14, "audio-off-half"), defaults={"aspectRatio": "16:9", "duration": 5})
model("kling-2-5-turbo", "Kling 2.5 Turbo Pro", "Kuaishou", "kling", "video",
      "Fast, physics-aware motion and the best camera control",
      [("t2v", "fal-ai/kling-video/v2.5-turbo/pro/text-to-video"), ("i2v", "fal-ai/kling-video/v2.5-turbo/pro/image-to-video", "fal", "+flf2v"),
       ("t2v", "kwaivgi/kling-v2.5-turbo-pro", "replicate"), ("i2v", "kwaivgi/kling-v2.5-turbo-pro", "replicate")],
      badges=["fast"], pricing=("second", 0.07), defaults={"aspectRatio": "16:9", "duration": 5})
model("veo-3-1", "Veo 3.1", "Google", "veo", "video",
      "State-of-the-art realism with synchronized sound and dialogue",
      [("t2v", "fal-ai/veo3.1"), ("i2v", "fal-ai/veo3.1/image-to-video"), ("flf2v", "fal-ai/veo3.1/first-last-frame-to-video"),
       ("ref2v", "fal-ai/veo3.1/reference-to-video"), ("t2v", "google/veo-3.1", "replicate"), ("i2v", "google/veo-3.1", "replicate"),
       ("extend", "fal-ai/veo3.1/extend-video", "fal", {"note": "fal retires Veo 3.1 extend on 2026-11-17"})],
      badges=["top", "audio", "hd"], pricing=("second", 0.4, "audio-off-half"), defaults={"aspectRatio": "16:9", "duration": 8, "resolution": "1080p"})
model("veo-3-1-fast", "Veo 3.1 Fast", "Google", "veo", "video", "Veo quality at a fraction of the cost",
      [("t2v", "fal-ai/veo3.1/fast"), ("i2v", "fal-ai/veo3.1/fast/image-to-video"), ("flf2v", "fal-ai/veo3.1/fast/first-last-frame-to-video"),
       ("extend", "fal-ai/veo3.1/fast/extend-video", "fal", {"note": "fal retires Veo 3.1 extend on 2026-11-17"})],
      badges=["fast", "audio"], pricing=("second", 0.15), defaults={"aspectRatio": "16:9", "duration": 8, "resolution": "1080p"})
model("veo-3-1-lite", "Veo 3.1 Lite", "Google", "veo", "video", "Cheapest Veo for drafts and volume",
      [("t2v", "fal-ai/veo3.1/lite"), ("i2v", "fal-ai/veo3.1/lite/image-to-video")],
      badges=["fast", "audio"], pricing=("second", 0.05), defaults={"aspectRatio": "16:9", "duration": 8, "resolution": "720p"})
model("gemini-omni-flash", "Gemini Omni Flash 1.1", "Google", "gemini-omni", "video",
      "Google's any-to-video model with reference and edit modes",
      [("t2v", "google/gemini-omni-flash/v1.1/text-to-video"), ("i2v", "google/gemini-omni-flash/v1.1/image-to-video"),
       ("ref2v", "google/gemini-omni-flash/v1.1/reference-to-video"), ("v2v", "google/gemini-omni-flash/v1.1/edit")],
      badges=["new", "audio"], defaults={"aspectRatio": "16:9"})
model("wan-3", "Wan 3.0", "Alibaba Wan", "wan", "video", "Alibaba's newest video model with audio",
      [("t2v", "alibaba/wan-3.0/text-to-video"), ("i2v", "alibaba/wan-3.0/image-to-video", "fal", "+flf2v"), ("ref2v", "alibaba/wan-3.0/reference-to-video")],
      badges=["new", "audio"], defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "1080p"})
model("wan-3-prime", "Wan 3.0 Prime", "Alibaba Wan", "wan", "video", "Highest-fidelity Wan",
      [("t2v", "alibaba/wan-3.0-prime/text-to-video"), ("i2v", "alibaba/wan-3.0-prime/image-to-video", "fal", "+flf2v"), ("ref2v", "alibaba/wan-3.0-prime/reference-to-video")],
      badges=["pro", "audio"], defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "1080p"})
model("wan-2-7", "Wan 2.7", "Alibaba Wan", "wan", "video", "Hosted Wan with references and video edit",
      [("t2v", "fal-ai/wan/v2.7/text-to-video"), ("i2v", "fal-ai/wan/v2.7/image-to-video", "fal", "+flf2v"),
       ("ref2v", "fal-ai/wan/v2.7/reference-to-video"), ("v2v", "fal-ai/wan/v2.7/edit-video"),
       # Replicate's Wan 2.7 video edit keeps the source's length and framing: its own ratio/duration enums would widen the fal routes'.
       ("v2v", "wan-video/wan-2.7-videoedit", "replicate", {"drop": ["aspectRatio", "duration"]})],
      badges=["audio"], defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "1080p"})
model("wan-2-6", "Wan 2.6", "Alibaba Wan", "wan", "video", "Multi-shot Wan with audio",
      [("t2v", "wan/v2.6/text-to-video"), ("i2v", "wan/v2.6/image-to-video"), ("ref2v", "wan/v2.6/reference-to-video")],
      badges=["audio"], defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "1080p"}, options={"multiShot": {"mode": "prompt", "maxShots": 6}})
model("wan-2-5", "Wan 2.5", "Alibaba Wan", "wan", "video", "Audio-driven video up to 1080p",
      [("t2v", "fal-ai/wan-25-preview/text-to-video"), ("i2v", "fal-ai/wan-25-preview/image-to-video")],
      badges=["audio"], pricing=("second", 0.15, "1080p"), defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "1080p"})
model("minimax-h3", "MiniMax H3", "MiniMax", "hailuo", "video", "Expressive characters and dynamic action",
      [("t2v", "minimax/h3/text-to-video"), ("i2v", "minimax/h3/image-to-video", "fal", "+flf2v"), ("ref2v", "minimax/h3/reference-to-video")],
      badges=["new"], defaults={"aspectRatio": "16:9"})
model("minimax-h3-max", "MiniMax H3 Max", "MiniMax", "hailuo", "video", "Top-tier MiniMax with extend",
      [("t2v", "minimax/h3-max/text-to-video"), ("i2v", "minimax/h3-max/image-to-video", "fal", "+flf2v"), ("ref2v", "minimax/h3-max/reference-to-video"),
       ("extend", "minimax/h3-max/extend-video")],
      badges=["pro"], defaults={"aspectRatio": "16:9"})
model("hailuo-2-3", "MiniMax Hailuo 2.3", "MiniMax", "hailuo", "video", "Expressive characters and dynamic action",
      [("t2v", "fal-ai/minimax/hailuo-2.3/pro/text-to-video"), ("i2v", "fal-ai/minimax/hailuo-2.3/pro/image-to-video")],
      pricing=("video", 0.49), defaults={"duration": 6}, fixed={"prompt_optimizer": True})
model("hailuo-02", "MiniMax Hailuo 02", "MiniMax", "hailuo", "video", "Physics-heavy shots with start & end frames",
      [("t2v", "fal-ai/minimax/hailuo-02/standard/text-to-video"), ("i2v", "fal-ai/minimax/hailuo-02/standard/image-to-video", "fal", "+flf2v")],
      pricing=("second", 0.045), defaults={"duration": 6, "resolution": "768P"}, fixed={"prompt_optimizer": True})
model("flux-3-video", "FLUX.3 Video", "Black Forest Labs", "flux", "video", "BFL's video model with keyframes and edits",
      [("t2v", "blackforestlabs/flux-3/text-to-video"), ("i2v", "blackforestlabs/flux-3/image-to-video"),
       ("flf2v", "blackforestlabs/flux-3/first-last-frame-to-video"), ("v2v", "blackforestlabs/flux-3/edit-video"),
       ("extend", "blackforestlabs/flux-3/extend-video")],
      badges=["new"], defaults={"aspectRatio": "16:9"})
model("ltx-2-5", "LTX 2.5 Pro", "Lightricks", "ltx", "video", "Fast 4K-capable video with audio",
      [("t2v", "lightricks/ltx-2.5/text-to-video/pro"), ("i2v", "lightricks/ltx-2.5/image-to-video/pro")],
      badges=["audio"], defaults={"aspectRatio": "16:9"})
model("pixverse-v6", "PixVerse V6", "PixVerse", "pixverse", "video", "Stylized social video with transitions",
      [("t2v", "fal-ai/pixverse/v6/text-to-video"), ("i2v", "fal-ai/pixverse/v6/image-to-video"), ("flf2v", "fal-ai/pixverse/v6/transition"),
       ("extend", "fal-ai/pixverse/v6/extend")],
      defaults={"aspectRatio": "16:9"})
model("vidu-q3", "Vidu Q3", "Shengshu", "vidu", "video", "Anime-friendly video with references",
      [("t2v", "fal-ai/vidu/q3/text-to-video"), ("i2v", "fal-ai/vidu/q3/image-to-video"), ("ref2v", "fal-ai/vidu/q3/reference-to-video/mix")],
      defaults={"aspectRatio": "16:9"})
model("luma-ray-3-2", "Luma Ray 3.2", "Luma", "luma", "video", "HDR, physically convincing motion",
      [("t2v", "luma/agent/ray/v3.2/text-to-video"), ("i2v", "luma/agent/ray/v3.2/image-to-video"), ("v2v", "luma/agent/ray/v3.2/video-to-video"),
       ("reframe", "luma/agent/ray/v3.2/reframe")],
      defaults={"aspectRatio": "16:9"})
model("ltx-reframe", "LTX Reframe", "Lightricks", "ltx", "video", "Change a clip's aspect ratio — fast, no prompt needed",
      [("reframe", "fal-ai/ltx-2.3/reframe")], defaults={"aspectRatio": "9:16"})
model("wan-vace-reframe", "Wan VACE Reframe (hosted)", "Alibaba Wan", "wan", "video", "Open-weights reframe: outpaints the new edges with a prompt",
      [("reframe", "fal-ai/wan-vace-14b/reframe")], defaults={"aspectRatio": "9:16"})

# ----- Video restyle / edit (research part 3; Shorts Studio, Mixed Media, Ad Multiplier)
model("happy-horse-video-edit", "Happy Horse Video Edit", "Alibaba", "happy-horse", "video",
      "Restyle or swap things in 3–60 s clips, with up to 5 reference images",
      [("v2v", "alibaba/happy-horse/video-edit")], badges=["new", "audio"], defaults={"resolution": "720p"},
      pricing=("second", 0.28, "720p, input + output seconds; 1080p $0.56"),
      controls=[("audio_setting", "Audio")])
model("lucy-edit-pro", "Lucy Edit Pro", "Decart", "lucy", "video",
      "Text-guided video edits that keep motion and identity — outfits, props, styles",
      [("v2v", "decart/lucy-edit/pro")], defaults={"resolution": "720p"}, fixed={"sync_mode": False}, pricing=("second", 0.15, "720p"))
model("runway-aleph-2", "Runway Aleph 2", "Runway", "runway", "video",
      "Runway's in-context video editor: restyle, relight, add or remove anything",
      [("v2v", "runwayml/aleph-2", "replicate")], badges=["pro"])
model("kling-o3-4k-edit", "Kling O3 4K Edit", "Kuaishou", "kling", "video",
      "Kling O3 video edits rendered in native 4K, keeps the original audio",
      [("v2v", "fal-ai/kling-video/o3/4k/video-to-video/edit")], badges=["4k"], pricing=("second", 0.42))
model("grok-imagine-video-edit", "Grok Imagine Video Edit", "xAI", "grok", "video",
      "Edit clips up to 8 s with a sentence",
      [("v2v", "xai/grok-imagine-video/edit-video")], badges=["fast"],
      pricing=("second", 0.06, "480p incl. input seconds; 720p $0.08"))
model("ltx-2-3-restyle", "LTX 2.3 Reference Restyle", "Lightricks", "ltx", "video",
      "Restyle a clip from a styled first frame, following its depth, edges or pose",
      [("v2v", "fal-ai/ltx-2.3-22b/reference-video-to-video")], badges=["audio"],
      pricing=("video", 0.18, "≈5 s at 720p; billed per megapixel of video"),
      sliders=[("video_strength", "Strength")], controls=[("preprocessor", "Follow"), ("camera_lora", "Camera")])

# ----- Avatars & lipsync
model("kling-avatar-2", "Kling Avatar 2.0", "Kuaishou", "kling", "video", "Photo + voice → expressive talking video",
      [("avatar", "fal-ai/kling-video/ai-avatar/v2/pro")], badges=["top"])
model("kling-avatar", "Kling AI Avatar", "Kuaishou", "kling", "video", "Photo + voice → talking video",
      [("avatar", "fal-ai/kling-video/v1/pro/ai-avatar")], pricing=("second", 0.115))
model("omnihuman-2", "OmniHuman 2", "ByteDance", "omnihuman", "video", "Full-body talking avatars with gestures",
      [("avatar", "bytedance/omnihuman/v2")], badges=["new"])
model("omnihuman", "OmniHuman 1.5", "ByteDance", "omnihuman", "video", "Full-body talking avatars",
      [("avatar", "fal-ai/bytedance/omnihuman/v1.5")], pricing=("second", 0.16))
model("infinitetalk-cloud", "InfiniteTalk (hosted)", "MeiGen", "infinitetalk", "video", "Long-form talking video from one photo",
      [("avatar", "fal-ai/infinitalk")], pricing=("second", 0.2), defaults={"resolution": "480p"})
model("sync-lipsync-3", "Sync Lipsync 3", "Sync Labs", "sync", "video", "Re-sync any video's lips to new audio",
      [("lipsync", "fal-ai/sync-lipsync/v3"), ("avatar", "fal-ai/sync-lipsync/v3/image-to-video")], badges=["new"])
model("sync-lipsync-2-pro", "Sync Lipsync 2 Pro", "Sync Labs", "sync", "video", "Studio-grade lipsync for existing footage",
      [("lipsync", "fal-ai/sync-lipsync/v2/pro")], pricing=("minute", 5))

# ----- Utilities
model("topaz-image", "Topaz Upscale", "Topaz Labs", "topaz", "image", "Up to 4x photo upscale with face recovery",
      [("upscale-image", "fal-ai/topaz/upscale/image")], pricing=("image", 0.08), fixed={"upscale_factor": 2, "face_enhancement": True})
model("seedvr-image", "SeedVR2 Upscale", "ByteDance Seed", "seedvr", "image", "One-step diffusion upscaling",
      [("upscale-image", "fal-ai/seedvr/upscale/image")])
model("recraft-crisp", "Recraft Crisp Upscale", "Recraft", "recraft", "image", "Clean, crisp upscale for design work",
      [("upscale-image", "fal-ai/recraft/upscale/crisp")])
model("topaz-video", "Topaz Video Upscale", "Topaz Labs", "topaz", "video", "Upscale and smooth any clip to 4K / 60fps",
      [("upscale-video", "fal-ai/topaz/upscale/video")], pricing=("second", 0.02), fixed={"upscale_factor": 2})
model("seedvr-video", "SeedVR2 Video Upscale", "ByteDance Seed", "seedvr", "video", "Restore and upscale video",
      [("upscale-video", "fal-ai/seedvr/upscale/video")])
model("birefnet-cloud", "BiRefNet background removal", "ZhengPeng7", "birefnet", "image", "Clean cut-outs with hair detail",
      [("bg-remove", "fal-ai/birefnet/v2")], pricing=("image", 0.0), fixed={"operating_resolution": "2048x2048", "output_format": "png"})
model("elevenlabs-tts", "ElevenLabs v3", "ElevenLabs", "elevenlabs", "audio", "Most expressive speech — audio tags like [whispers] and [laughs]",
      [("tts", "fal-ai/elevenlabs/tts/eleven-v3")], badges=["top"], pricing=("request", 0.1, "per 1k chars"), defaults={"voice": "JBFqnCBsd6RMkjVDRZzb"})
model("elevenlabs-v4", "ElevenLabs v4", "ElevenLabs", "elevenlabs", "audio", "Newest ElevenLabs voice model — natural, stable long-form",
      [("tts", "elevenlabs/tts/eleven-v4")], badges=["new"], pricing=("request", 0.08, "per 1k chars"), defaults={"voice": "JBFqnCBsd6RMkjVDRZzb"})
model("elevenlabs-v4-turbo", "ElevenLabs v4 Turbo", "ElevenLabs", "elevenlabs", "audio", "Low-latency v4 at half the price",
      [("tts", "elevenlabs/tts/eleven-v4-turbo")], badges=["fast"], pricing=("request", 0.04, "per 1k chars"), defaults={"voice": "JBFqnCBsd6RMkjVDRZzb"})
model("elevenlabs-multilingual-v2", "ElevenLabs Multilingual v2", "ElevenLabs", "elevenlabs", "audio", "29 languages with speed and style control",
      [("tts", "fal-ai/elevenlabs/tts/multilingual-v2")], pricing=("request", 0.1, "per 1k chars"), defaults={"voice": "JBFqnCBsd6RMkjVDRZzb"})
model("elevenlabs-dialogue", "ElevenLabs Dialogue", "ElevenLabs", "elevenlabs", "audio", "Several speakers, one natural conversation",
      [("dialogue", "fal-ai/elevenlabs/text-to-dialogue/eleven-v3")], badges=["new"], pricing=("request", 0.1, "per 1k chars"), defaults={"voice": "JBFqnCBsd6RMkjVDRZzb"})
model("chatterbox-cloud", "Chatterbox (hosted)", "Resemble AI", "chatterbox", "audio", "Clone any voice from a 10-second sample",
      [("tts", "fal-ai/chatterbox/text-to-speech")], pricing=("request", 0.025, "per 1k chars"))
model("index-tts-2-cloud", "IndexTTS-2 (hosted)", "Bilibili", "index-tts", "audio", "Zero-shot cloning with emotion control",
      [("tts", "fal-ai/index-tts-2/text-to-speech")], pricing=("second", 0.002))
# Higgsfield's Audio model selector also lists Inworld and MiniMax Speech (research part 3 / part 2).
model("inworld-tts", "Inworld TTS 1.5 Max", "Inworld", "inworld", "audio", "The cheapest natural narration — 113 voices in 15 languages",
      [("tts", "fal-ai/inworld-tts")], badges=["fast"], pricing=("request", 0.01, "per 1k chars"), defaults={"voice": "Craig (en)"})
model("minimax-speech-2-8", "MiniMax Speech 2.8 HD", "MiniMax", "minimax-speech", "audio", "Expressive multilingual speech with emotion control",
      [("tts", "fal-ai/minimax/speech-2.8-hd", "fal", {"fixed": {"output_format": "url"}})], pricing=("request", 0.1, "per 1k chars"),
      defaults={"voice": "Wise_Woman"}, sliders=[("voice_setting.speed", "Speed")],
      controls=[("voice_setting.emotion", "Emotion"), ("language_boost", "Language")])
model("elevenlabs-voice-changer", "ElevenLabs Voice Changer", "ElevenLabs", "elevenlabs", "audio", "Re-voice a recording with any premade voice",
      [("voice-change", "fal-ai/elevenlabs/voice-changer")], pricing=("minute", 0.3), defaults={"voice": "JBFqnCBsd6RMkjVDRZzb"})
model("chatterbox-vc-cloud", "Chatterbox Voice Conversion (hosted)", "Resemble AI", "chatterbox", "audio", "Turn a recording into any voice from a sample",
      [("voice-change", "fal-ai/chatterbox/speech-to-speech")], pricing=("minute", 0.015))
model("heygen-translate", "HeyGen Translate", "HeyGen", "heygen", "video", "Lip-synced video translation into 170+ languages and accents",
      [("dub", "fal-ai/heygen/v2/translate/precision")], badges=["top"], pricing=("second", 0.1))
model("heygen-translate-fast", "HeyGen Translate Speed", "HeyGen", "heygen", "video", "Faster, cheaper lip-synced translation",
      [("dub", "fal-ai/heygen/v2/translate/speed")], badges=["fast"], pricing=("second", 0.05))
model("elevenlabs-dubbing", "ElevenLabs Dubbing", "ElevenLabs", "elevenlabs", "video", "Dub video or audio while keeping each speaker's voice",
      [("dub", "fal-ai/elevenlabs/dubbing")], pricing=("minute", 0.6))
# Sound effects and music (research part 3): Mirelo and Sonilo are the jobs Higgsfield's Audio runs.
model("mirelo-sfx-2", "Mirelo SFX 2.0", "Mirelo", "mirelo", "audio", "Higgsfield's sound-effects model — layered, cinematic SFX up to 10 minutes",
      [("sfx", "mirelo-ai/sfx2.0/text-to-audio")], badges=["top", "new"], defaults={"duration": 5}, options={"durations": [2, 5, 10, 30, 60]},
      pricing=("second", 0.01, "intro price until 2026-12-13, then $0.015"))
# Sonilo answers in AAC unless asked: MP3 plays and downloads everywhere.
model("sonilo-sfx", "Sonilo SFX 1.1", "Sonilo", "sonilo", "audio", "Fast, cheap sound effects up to 3 minutes",
      [("sfx", "sonilo/v1.1/text-to-sound-effects")], badges=["fast"], defaults={"duration": 5}, options={"durations": [2, 5, 8, 15, 30]},
      fixed={"audio_format": "mp3"})
model("stable-audio-3-sfx", "Stable Audio 3 SFX", "Stability AI", "stable-audio", "audio", "Stability's small SFX model — crisp one-shots and ambiences",
      [("sfx", "fal-ai/stable-audio-3/small/sfx/text-to-audio")], defaults={"duration": 10}, options={"durations": [5, 10, 30, 60]})
model("cassette-sfx", "CassetteAI Sound Effects", "CassetteAI", "cassette", "audio", "One-cent sound effects up to 30 s",
      [("sfx", "cassetteai/sound-effects-generator")], badges=["fast"], defaults={"duration": 5}, options={"durations": [2, 5, 10, 30]})
model("seed-audio", "Seed Audio 1.0", "ByteDance", "seed-audio", "audio", "Higgsfield's Seed Audio: speech, ambience, music and Foley from one prompt",
      [("sfx", "bytedance/seed-audio-1.0"), ("tts", "bytedance/seed-audio-1.0")], badges=["new"])
model("sonilo-music", "Sonilo Music 1.1", "Sonilo", "sonilo", "audio", "Higgsfield's music model — full tracks up to 10 minutes",
      [("music", "sonilo/v1.1/text-to-music")], badges=["top", "new"], defaults={"duration": 30}, options={"durations": [15, 30, 60, 120, 240]})
model("lyria-3", "Lyria 3", "Google", "lyria", "audio", "Google DeepMind's music model, from a prompt or an image",
      [("music", "fal-ai/lyria3"), ("music", "google/lyria-3", "replicate")])
model("lyria-3-pro", "Lyria 3 Pro", "Google", "lyria", "audio", "Longer, richer Lyria 3 tracks",
      [("music", "fal-ai/lyria3/pro"), ("music", "google/lyria-3-pro", "replicate")], badges=["pro"])
# A prompt alone has no lyrics to sing: lyrics_optimizer writes them from the prompt.
model("minimax-music-2-5", "MiniMax Music 2.5", "MiniMax", "minimax-music", "audio", "Songs with vocals, lyrics written from your prompt",
      [("music", "fal-ai/minimax-music/v2.5")], fixed={"lyrics_optimizer": True})
model("stable-audio-3-music", "Stable Audio 3 Music", "Stability AI", "stable-audio", "audio", "Quick, cheap loops and beds up to 2 minutes",
      [("music", "fal-ai/stable-audio-3/small/music/text-to-audio")], badges=["fast"], defaults={"duration": 30}, options={"durations": [10, 30, 60, 120]})
model("mureka-song", "Mureka 9.5", "Mureka", "mureka", "audio", "Full songs with vocals in many genres",
      [("music", "mureka/api/generate/song")], pricing=("request", 0.75, "prompt-to-song on mureka-9.5; with lyrics $0.225"),
      # Its vocal gender only applies to lyrics-to-song, which Fuobe doesn't send yet.
      controls=[("model", "Version")])
model("stable-audio-2-5", "Stable Audio 2.5", "Stability AI", "stable-audio", "audio", "Sound design and music beds up to 3 minutes",
      [("sfx", "fal-ai/stable-audio-25/text-to-audio"), ("music", "fal-ai/stable-audio-25/text-to-audio"),
       ("sfx", "stability-ai/stable-audio-2.5", "replicate"), ("music", "stability-ai/stable-audio-2.5", "replicate")],
      defaults={"duration": 30}, options={"durations": [10, 30, 60, 120, 190]})
model("elevenlabs-sfx", "ElevenLabs Sound Effects", "ElevenLabs", "elevenlabs", "audio", "Describe a sound, get a sound",
      [("sfx", "fal-ai/elevenlabs/sound-effects/v2")], pricing=("second", 0.002), defaults={"duration": 5}, options={"durations": [2, 5, 10, 22]})
model("elevenlabs-music", "ElevenLabs Music", "ElevenLabs", "elevenlabs", "audio", "Studio-quality songs from a prompt",
      [("music", "fal-ai/elevenlabs/music")], pricing=("minute", 0.6), defaults={"duration": 30}, options={"durations": [15, 30, 60, 120]})
model("birefnet-video", "BiRefNet video (hosted)", "ZhengPeng7", "birefnet", "video", "Transparent WebM cut-outs of the subject",
      [("bg-remove-video", "fal-ai/birefnet/v2/video")], pricing=("second", 0.0), fixed={"video_output_type": "VP9 (.webm)", "model": "General Use (Heavy)"})
model("bria-video-bg", "Bria video background removal", "Bria", "bria", "video", "Production-grade video matting with audio kept",
      [("bg-remove-video", "bria/video/background-removal/v3")], pricing=("second", 0.05),
      fixed={"background_color": "Transparent", "output_container_and_codec": "webm_vp9"})
model("depth-anything-video-cloud", "Video Depth Anything (hosted)", "ByteDance", "depth-anything", "video", "Stable depth maps for every frame",
      [("depth-video", "fal-ai/depth-anything-video")], pricing=("second", 0.04), fixed={"model": "VDA-Base", "colormap": "grayscale"})
model("lightx-relight", "LightX Relight", "LightX", "lightx", "video", "Relight a video from a description and a light direction",
      [("relight-video", "fal-ai/lightx/relight")], pricing=("second", 0.1),
      fixed={"relit_cond_type": "ic", "relight_parameters.bg_source": "Left"},
      options={"controls": [{"param": "relight_parameters.bg_source", "label": "Light from", "values": ["Left", "Right", "Top", "Bottom"], "default": "Left"}]})
model("mmaudio-cloud", "MMAudio", "hkchengrex", "mmaudio", "video", "Add matching sound to a silent video",
      [("v2a", "fal-ai/mmaudio-v2")], pricing=("second", 0.001))
# Its duration defaults to 10 s and is clamped to the video: ask for the maximum so the whole clip gets sound.
model("mirelo-sfx-2-video", "Mirelo SFX 2.0 for video", "Mirelo", "mirelo", "video", "Sound effects in sync with your video, speech kept",
      [("v2a", "mirelo-ai/sfx2.0/video-to-video")], badges=["top", "new"], pricing=("second", 0.01, "intro price until 2026-12-13, then $0.015"),
      api_defaults={"duration": 600})

# ----- Image tools: layers, text layers, cut-outs, vectors (research part 3; Higgsfield Layers)
model("seedream-5-layers", "Seedream 5.0 Layers", "ByteDance", "seedream", "image",
      "The model Higgsfield Layers runs on: background + up to 16 named, positioned layers",
      [("layers", "bytedance/seedream/v5/pro/layerize")], badges=["top", "new"], defaults={"resolution": "auto"},
      pricing=("request", 0.17, "$0.034 per layer, ≈5 layers; double above 1536²"))
model("seedream-5-flash-layers", "Seedream 5.0 Flash Layers", "ByteDance", "seedream", "image", "Faster, cheaper Seedream layer split",
      [("layers", "bytedance/seedream/v5/flash/layerize")], badges=["fast"], defaults={"resolution": "auto"},
      pricing=("request", 0.135, "$0.027 per layer, ≈5 layers"))
model("qwen-image-layered-cloud", "Qwen-Image Layered (hosted)", "Alibaba Qwen", "qwen-image", "image",
      "Open-weights layer split: 1–10 full-canvas RGBA layers",
      [("layers", "fal-ai/qwen-image-layered"), ("layers", "qwen/qwen-image-layered", "replicate")])
model("ideogram-3-text-layers", "Ideogram 3.0 Text Layers", "Ideogram", "ideogram", "image",
      "Lift the text off a poster: a clean background plus editable text blocks",
      [("text-layers", "fal-ai/ideogram/v3/layerize-text")], badges=["new"])
model("ideogram-remove-bg", "Ideogram Remove Background", "Ideogram", "ideogram", "image", "Clean transparent cut-outs for one cent",
      [("bg-remove", "fal-ai/ideogram/remove-background")], badges=["fast"], pricing=("image", 0.01))
model("recraft-vectorize", "Recraft Vectorize", "Recraft", "recraft", "image", "Turn any image into a clean, editable SVG",
      [("vectorize", "fal-ai/recraft/vectorize"), ("vectorize", "recraft-ai/recraft-vectorize", "replicate")], badges=["top"])
model("image2svg", "Image to SVG (VTracer)", "VTracer", "vtracer", "image", "Half-cent tracing for logos, icons and flat art",
      [("vectorize", "fal-ai/image2svg")], badges=["fast"], controls=[("colormode", "Colours"), ("mode", "Curves")])

# ----- Video & audio utilities (research part 3): steps for chains (trim, soundtrack) and studios (captions, transcripts, stems)
model("trim-video", "Trim video", "fal", "utility", "video", "Keep the part between two times",
      [("trim", "fal-ai/workflow-utilities/trim-video", "fal", {"drop": ["duration"]})],
      pricing=("request", 0.001, "billed per compute second"), hidden=True)
model("merge-audio-video", "Add soundtrack", "fal", "utility", "video", "Replace a video's sound with an audio track",
      [("mux", "fal-ai/ffmpeg-api/merge-audio-video")], pricing=("second", 0.0002), hidden=True)
# Auto Subtitle has no language detection (its language defaults to English): the spoken language is a picker.
model("auto-subtitle", "Auto Subtitle", "fal", "captions", "video", "TikTok-style karaoke captions; English unless you pick the spoken language",
      [("captions", "fal-ai/workflow-utilities/auto-subtitle")], badges=["top"],
      sliders=[("words_per_subtitle", "Words per caption"), ("font_size", "Size")],
      controls=[("font_weight", "Weight"), ("font_color", "Colour"), ("highlight_color", "Highlight"), ("position", "Position")])
model("veed-subtitles", "VEED Subtitles", "VEED", "veed", "video", "30 designed caption styles, with optional translation",
      [("captions", "veed/subtitles")], fixed={"preset": "simple"}, controls=[("preset", "Style")],
      pricing=("minute", 0.1, "basic styles; dynamic styles (glass, whisper, glide, fusion, terminal, handwritten, backdrop) and >1080p 2x; translation +$0.20/min"))
model("scribe-v2", "ElevenLabs Scribe v2", "ElevenLabs", "elevenlabs", "text", "Word-timed transcripts with speakers and sound events",
      [("transcribe", "fal-ai/elevenlabs/speech-to-text/scribe-v2"), ("transcribe", "elevenlabs/scribe-v2", "replicate")], badges=["top"],
      pricing=("minute", 0.008, "+30% with key terms"))
# Wizper's language defaults to English; null makes it detect the language (unless one is picked).
model("wizper", "Wizper (Whisper v3)", "fal", "whisper", "text", "Fast Whisper large-v3 transcripts in segments, any language",
      [("transcribe", "fal-ai/wizper")], badges=["fast"], api_defaults={"language": None})
# Word-level chunks: the transcript's cues are built from word timings (segment chunks are the API default).
model("whisper", "Whisper large-v3", "OpenAI", "whisper", "text", "Whisper large-v3 with word timings, any language",
      [("transcribe", "fal-ai/whisper")], fixed={"chunk_level": "word"})
model("demucs", "Demucs stem split", "Meta", "demucs", "audio", "Split a track into vocals, drums, bass and the rest",
      [("separate-audio", "fal-ai/demucs")], fixed={"model": "htdemucs"})
# Translate & dub (cloud, step by step): the clean voice straight from the video, to clone in the new language.
# The cloud dub's voice track (av-tools): the spoken lines placed at their cue times over a still for the video's
# length (compose renders a video), then its soundtrack read back as audio for voice conversion and lip re-sync.
model("compose-timeline", "Voice timeline", "fal", "utility", "video", "Place audio clips at their start times on a timeline",
      [("timeline", "fal-ai/ffmpeg-api/compose")], pricing=("second", 0.0002), hidden=True)
model("extract-soundtrack", "Extract soundtrack", "fal", "utility", "audio", "A video's soundtrack as an audio file",
      [("separate-audio", "fal-ai/workflow-utilities/extract-audio")], pricing=("second", 0.0002, "billed by compute time"), hidden=True)
model("elevenlabs-voice-isolation", "ElevenLabs Voice Isolation", "ElevenLabs", "elevenlabs", "audio", "Clean speech from a video or recording — music and noise removed",
      [("separate-audio", "fal-ai/elevenlabs/audio-isolation")], pricing=("minute", 0.1))

# ----- Image to 3D (research part 3; product spins, 3D blocking)
model("hunyuan-3d-3-1-pro", "Hunyuan3D 3.1 Pro", "Tencent Hunyuan", "hunyuan-3d", "model3d", "Textured, game-ready 3D models from a product photo",
      [("image-to-3d", "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d")], badges=["top", "new"], pricing=("request", 0.375, "+$0.15 with PBR"),
      controls=[("generate_type", "Mode")])
model("hunyuan-3d-3-1-rapid", "Hunyuan3D 3.1 Rapid", "Tencent Hunyuan", "hunyuan-3d", "model3d", "Faster, cheaper single-view Hunyuan3D",
      [("image-to-3d", "fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d")], badges=["fast"], pricing=("request", 0.225, "+$0.15 with PBR"))
model("trellis-2", "TRELLIS.2", "Microsoft", "trellis", "model3d", "Open-weights image to GLB with detailed geometry",
      [("image-to-3d", "fal-ai/trellis-2")], defaults={"resolution": "1024"}, pricing=("request", 0.3, "1024p; 512p $0.25, 1536p $0.35"))
model("tripo-h3-1", "Tripo H3.1", "Tripo", "tripo", "model3d", "Clean topology and PBR textures, ready for engines",
      [("image-to-3d", "tripo3d/h3.1/image-to-3d")], pricing=("request", 0.3, "standard textures; untextured $0.20, HD $0.40"),
      controls=[("texture_quality", "Texture"), ("geometry_quality", "Geometry")])
model("meshy-7-1", "Meshy 7.1", "Meshy", "meshy", "model3d", "Textured models with optional auto-rigging; describe the texture in the prompt",
      [("image-to-3d", "meshy/v7.1/image-to-3d")], pricing=("request", 1.2, "textured; untextured $0.80, rigging +$0.20"),
      controls=[("model_type", "Mesh"), ("topology", "Topology")])


# ---------------------------------------------------------------------------

# Numeric voice settings exposed as sliders.
SLIDER_LABELS = {
    "stability": "Stability", "similarity_boost": "Similarity", "style": "Style exaggeration", "speed": "Speed",
    "exaggeration": "Emotion", "cfg": "Pace / guidance", "temperature": "Variety", "strength": "Voice strength",
}

# ElevenLabs premade voices (docs/research/paid-model-apis-2.json → elevenlabsVoices). Sent by voice_id.
_EL = RESEARCH_2.get("elevenlabsVoices") or {}
ELEVEN_VOICES = [
    {"id": v["voice_id"], "name": v["name"], "hint": " · ".join(x for x in [(v.get("label") or "").partition(" - ")[2], v.get("accent")] if x)}
    for v in (_EL.get("voices") or [])
]

# ElevenLabs dubbing takes ISO 639-1 codes.
ISO_LANGUAGES = ["en", "es", "fr", "de", "it", "pt", "pl", "hi", "ja", "ko", "zh", "ar", "ru", "tr", "nl", "sv", "id", "fil", "uk", "el", "cs",
                 "ro", "da", "fi", "bg", "hr", "sk", "ms", "ta", "vi", "hu", "no"]


def warn(msg):
    print(f"warning: {msg}", file=sys.stderr)


def union(a, b):
    out = list(a)
    for x in b:
        if x not in out:
            out.append(x)
    return out


def num(v):
    try:
        f = float(v)
        return int(f) if f.is_integer() else f
    except (TypeError, ValueError):
        return None


def spec_at(inputs, path):
    """The research spec of a (possibly dotted) input field: voice_setting.voice_id → inputs.voice_setting.fields.voice_id."""
    head, _, rest = path.partition(".")
    spec = inputs.get(head)
    for part in rest.split(".") if rest else []:
        spec = ((spec or {}).get("fields") or {}).get(part)
    return spec if isinstance(spec, dict) else None


def palette_format(spec):
    """How an API wants its colour palette (FieldMap.palette.format), from the research schema."""
    if not spec:
        return None
    if spec.get("type") == "object" and "members" in (spec.get("fields") or {}):
        return "ideogram"  # Ideogram color_palette {members: [{rgb: {r, g, b}, color_weight}]}
    if spec.get("type") == "array":
        item = spec.get("itemSchema") or (spec.get("items") if isinstance(spec.get("items"), dict) else {}) or {}
        if {"r", "g", "b"} <= set(item):
            return "rgb-object"  # Recraft on fal: [{r, g, b}]
        if "rgb" in (item.get("fields") or item):
            return "rgb-array"  # Recraft on Higgsfield: [{rgb: [r, g, b]}]
        if spec.get("items") == "string":
            return "hex"
    return None


def voice_list(spec):
    """Premade voices from a voice field's enum (Inworld "Loretta (en)") or documented examples (MiniMax "Wise_Woman")."""
    vals = (spec or {}).get("values") or (spec or {}).get("examples") or []
    out = []
    for v in vals:
        if not isinstance(v, str):
            continue
        m_ = re.match(r"^(.*?)\s*\(([^)]+)\)$", v)
        if m_:  # "Loretta (en)"
            out.append({"id": v, "name": m_.group(1), "hint": m_.group(2)})
        elif re.fullmatch(r"[a-z]+(_[a-z]+)+", v):  # Seed's "vivi_mixed_en_zh_ja_es_id": a name, then its languages
            name, *langs = v.split("_")
            out.append({"id": v, "name": name.capitalize(), "hint": " · ".join(x for x in langs if x != "mixed")})
        else:  # MiniMax's "Wise_Woman"
            out.append({"id": v, "name": v.replace("_", " ")})
    return out


def time_field(key, spec):
    """FieldMap DurationField for a time in seconds (start/end of a trim, an audio offset)."""
    t = "number" if (spec or {}).get("type") in ("number", "integer") else "string"
    return {"key": key, "type": t, **({"multiplier": 1000} if key.endswith("_ms") else {})}


def add_slider(opts, param, label, spec):
    if not spec or "minimum" not in spec or "maximum" not in spec or any(s["param"] == param for s in opts.get("sliders", [])):
        return
    lo, hi = spec["minimum"], spec["maximum"]
    opts.setdefault("sliders", []).append({"param": param, "label": label, "min": lo, "max": hi, "step": 0.05 if hi - lo <= 4 else 1,
                                           "default": spec.get("default", lo)})


def is_sentinel(v, default):
    """An enum value that means "let the API decide": the composer's own Auto option already sends nothing."""
    s = str(v).strip().lower()
    return s == "auto" or (s == "none" and str(default).strip().lower() == "none")


def add_control(opts, param, label, spec, fallback=None):
    """fallback: what Fuobe sends when the control is left on Auto (a FieldMap default), shown as the control's default."""
    default = fallback if fallback is not None else (spec or {}).get("default")
    vals = [v for v in ((spec or {}).get("values") or []) if v != "" and not is_sentinel(v, default)]
    if not vals or any(c["param"] == param for c in opts.get("controls", [])):
        return
    keep = default is not None and not is_sentinel(default, default)
    opts.setdefault("controls", []).append({"param": param, "label": label, "values": vals, **({"default": default} if keep else {})})


def map_fields(fmap):
    """Every top-level provider field a FieldMap can write (canonical keys, fixed and default fields)."""
    out = []
    for k, v in fmap.items():
        if k in ("fixed", "defaults"):
            out += list(v)
        elif k in ("seedRange", "maskFormat"):
            continue
        elif isinstance(v, str):
            out.append(v)
        elif isinstance(v, dict):
            out += [v[f] for f in ("key", "background", "shotType", "flag") if isinstance(v.get(f), str)]
    return [f.split(".")[0] for f in out]


def mask_format(ep):
    """Ideogram paints black = change; OpenAI's GPT Image uses transparent = change; others white."""
    return "black" if "ideogram" in ep else "alpha" if ("gpt-image" in ep or ep.startswith("openai/")) else None


def build_route(op, ep, provider, m, opts, ropts=None):
    ropts = ropts or {}
    e = EPS.get((provider, ep))
    if not e:
        warn(f"{m['id']}: endpoint {provider}:{ep} not in research")
        return None
    if not e.get("verified"):
        warn(f"{m['id']}: {ep} is not verified")
    inputs = e.get("inputs") or {}
    kf = dict(e.get("keyFields") or {})
    # A route can ignore key fields whose meaning doesn't fit Fuobe's slot (e.g. Ideogram edit's style refs).
    for k in ropts.get("drop") or []:
        kf.pop(k, None)
    # Part 3 slot names that are the same canonical input: the person in a try-on is the main image,
    # style references are the reference images, a garment / scene / style image is the second image.
    labels = [None, None]
    if "person" in kf and "image" not in kf:
        kf["image"] = kf.pop("person")
        labels[0] = "person photo"
    if "styleImages" in kf and "images" not in kf and (inputs.get(kf["styleImages"]) or {}).get("type") == "array":
        kf["images"] = kf["styleImages"]
    for k, label in (("garment", "garment"), ("sceneImage", "scene reference"), ("styleImage", "style image")):
        if k in kf and "image2" not in kf and (inputs.get(kf[k]) or {}).get("type") != "array":
            kf["image2"] = kf[k]
            labels[1] = label
    # Two-image APIs whose second image is required (try-on garments) can't run on one picture.
    if "image2" in kf and (inputs.get(kf["image2"]) or {}).get("required") and (inputs.get(kf.get("image", "")) or {}).get("required"):
        opts["minImages"] = 2
        opts["imageLabels"] = [labels[0] or "image", labels[1] or "second image"]
    # Transcription and stem splitting work from the audio; ignore any prompt-like hint field.
    if op in ("transcribe", "separate-audio"):
        kf.pop("prompt", None)
    fmap = {}
    # Prompt
    if "prompt" in kf:
        if kf["prompt"] != "prompt":
            fmap["prompt"] = kf["prompt"]
    else:
        fmap["prompt"] = False
    # Relight endpoints take the lighting description as the prompt.
    if "lightingPrompt" in kf:
        fmap["prompt"] = kf["lightingPrompt"]
    # Zero-shot TTS takes its reference voice in the "audio" field; voice conversion names it separately.
    if op == "tts" and "audio" in kf:
        kf["referenceVoice"] = kf.pop("audio")
    if "referenceVoice" in kf and (inputs.get(kf["referenceVoice"]) or {}).get("type") != "array":
        fmap["voiceAudio"] = kf["referenceVoice"]
        opts["voiceClone"] = True
    if "voice" in kf and "[]" not in kf["voice"]:
        fmap["voice"] = kf["voice"]
    if "voice" in kf and "elevenlabs" in ep:
        opts["voices"] = ELEVEN_VOICES
    elif "voice" in kf and "voices" not in opts and voice_list(spec_at(inputs, kf["voice"])):
        opts["voices"] = voice_list(spec_at(inputs, kf["voice"]))
    if "dialogue" in kf:
        fmap["dialogue"] = {"key": kf["dialogue"], "text": "text", "voice": "voice"}
    if "targetLanguage" in kf:
        fmap["targetLanguage"] = kf["targetLanguage"]
        enum = (inputs.get(kf["targetLanguage"]) or {}).get("values")
        opts["languages"] = enum or ISO_LANGUAGES
    # The model's own slider/control labels win over the generic voice-setting labels below.
    for path, label in m.get("sliders") or []:
        add_slider(opts, path, label, spec_at(inputs, path))
    for path, label in m.get("controls") or []:
        add_control(opts, path, label, spec_at(inputs, path), (m.get("api_defaults") or {}).get(path))
    for k, v in inputs.items():
        # Voice settings belong to speech models; a transcriber's "temperature" is not a voice's variety.
        if k in SLIDER_LABELS and isinstance(v, dict) and (op in ("tts", "voice-change", "dialogue") or k == "strength"):
            # "strength" is a voice setting on speech models only (Topaz's is the enhancement strength).
            add_slider(opts, k, "Strength" if k == "strength" and m["kind"] != "audio" else SLIDER_LABELS[k], v)
    # Some APIs call their boolean sound switch "audio" (Wan 3.0); that's generateAudio, not an audio file.
    if "audio" in kf and (inputs.get(kf["audio"]) or {}).get("type") == "boolean":
        kf.setdefault("generateAudio", kf.pop("audio"))
    # Part 3 names for clip lists (merge-videos' video_urls, Seed Audio's reference audio_urls).
    for k in ("videos", "audios"):
        if k in kf and (inputs.get(kf[k]) or {}).get("type") == "array":
            kf.setdefault(k[:-1], kf.pop(k))
    for k in ["negativePrompt", "image", "images", "endImage", "mask", "video", "audio", "numOutputs", "seed", "generateAudio"]:
        if k in kf:
            if k in ("video", "audio", "image", "endImage", "mask") and (inputs.get(kf[k]) or {}).get("type") == "array":
                if k == "video" and ropts.get("videoArray"):
                    fmap["videoArray"] = kf[k]
                elif k in ("video", "audio"):
                    # Lists of clips: reference videos / audio for reference-to-video (Seedance @Video1, @Audio1),
                    # fed from inputs.videos / inputs.audios.
                    fmap[k + "s"] = kf[k]
                    spec = inputs.get(kf[k]) or {}
                    cap = num(spec.get("maxItems")) or num((re.search(r"\bup to (\d+)", spec.get("desc") or "", re.I) or [None, None])[1]) or 3
                    key = "maxVideos" if k == "video" else "maxAudios"
                    opts[key] = max(opts.get(key, 0), cap)
                continue
            fmap[k] = kf[k]
    # Multi-shot, draft mode and draft completion (research part 2 key fields).
    if "multiShot" in kf and op in ("t2v", "i2v", "ref2v") and (inputs.get(kf["multiShot"]) or {}).get("type") in ("array", "string"):
        item = (inputs.get(kf["multiShot"]) or {}).get("itemSchema") or {}
        dtype = "string" if (item.get("duration") or {}).get("valueType") == "string" else "number"
        ms = {"key": kf["multiShot"], "durationType": dtype}
        if (inputs.get(kf["multiShot"]) or {}).get("type") == "string":
            ms["json"] = True
        if "shotType" in kf:
            ms["shotType"] = kf["shotType"]
        fmap["multiShot"] = ms
        opts["multiShot"] = {"mode": "native", "maxShots": 6}
    if "draft" in kf and op in ("t2v", "i2v", "ref2v"):
        fmap["draft"] = kf["draft"]
        opts["draft"] = True
    if "draftId" in kf:
        fmap["draftId"] = kf["draftId"]
    # Research part 3 slots.
    if "image2" in kf:
        fmap["image2"] = kf["image2"]
    for k in ("startTime", "endTime"):
        if k in kf:
            fmap[k] = time_field(kf[k], inputs.get(kf[k]))
    if "fps" in kf:
        fmap["fps"] = kf["fps"]
    if "styleId" in kf:
        fmap["styleId"] = kf["styleId"]
    if "numLayers" in kf:
        fmap["numLayers"] = kf["numLayers"]
    # fal compose: the timeline's tracks are built from the clips and their start times (FieldMap.timeline).
    if "tracks" in kf and op == "timeline":
        fmap["timeline"] = kf["tracks"]
    if "palette" in kf:
        fmt = palette_format(inputs.get(kf["palette"]))
        if fmt:
            fmap["palette"] = {"key": kf["palette"], "format": fmt}
            bg = kf.get("backgroundColor")
            if bg and {"r", "g", "b"} <= set((inputs.get(bg) or {}).get("fields") or {}):
                fmap["palette"]["background"] = bg
        else:
            warn(f"{m['id']}: {ep} palette field {kf['palette']} has an unknown shape")
    # The language of the speech: transcription, captions and dubbing take it as their "language".
    src_lang = kf.get("sourceLanguage") or (kf.get("language") if op in ("transcribe", "captions", "dub") else None)
    if src_lang:
        enum = [v for v in ((inputs.get(src_lang) or {}).get("values") or []) if isinstance(v, str) and v]
        # An API with its own list (VEED's "es-ES", Wizper's "es") gets the matching entry; the picker offers ISO codes.
        fmap["sourceLanguage"] = {"key": src_lang, "values": enum} if enum else src_lang
        codes = union([], [v.split("-")[0].lower() for v in enum if re.fullmatch(r"[a-z]{2,3}", v.split("-")[0].lower())]) if enum else ISO_LANGUAGES
        opts["sourceLanguages"] = union(opts.get("sourceLanguages", []), codes)
    # Transcribers take a video file in their audio field too.
    if op == "transcribe" and "audio" in kf and "video" not in kf:
        fmap["video"] = kf["audio"]
    # LTX/others sometimes have image key named differently but keyFields covers it.
    if "negativePrompt" in fmap:
        opts["negativePrompt"] = True
    if "seed" in fmap:
        opts["seed"] = True
    if "endImage" in fmap:
        opts["endFrame"] = True
    if "generateAudio" in fmap:
        opts["audio"] = True
    # Aspect ratio
    if "aspectRatio" in kf:
        key = kf["aspectRatio"]
        spec = inputs.get(key, {})
        enum = spec.get("values") or spec.get("enumValues") or []
        if not enum and spec.get("type") == "union":
            # "enum or free string" unions (FLUX Ultra's aspect_ratio): offer the enum.
            enum = [v for var in spec.get("variants") or [] for v in (var.get("values") or [])]
        if key == "image_size" or any("landscape" in str(v) or "square" in str(v) for v in enum):
            fmap["aspectRatio"] = {"key": key, "values": IMAGE_SIZE_MAP}
            opts["aspectRatios"] = union(opts.get("aspectRatios", []), IMG_AR)
        else:
            fmap["aspectRatio"] = key
            ratios = [v for v in enum if RATIO.match(str(v)) or v == "auto"]
            if not ratios and spec.get("type") == "string":
                ratios = ["16:9", "9:16", "1:1"] if m["kind"] == "video" else IMG_AR
            opts["aspectRatios"] = union(opts.get("aspectRatios", []), ratios)
    # Resolution
    if "resolution" in kf:
        key = kf["resolution"]
        fmap["resolution"] = key
        enum = (inputs.get(key) or {}).get("values") or []
        if enum and (inputs.get(key) or {}).get("valueType") in ("integer", "number"):
            # Numeric tiers (TRELLIS 512/1024/1536) are picked as strings and sent as numbers.
            fmap["resolution"] = {"key": key, "values": {str(v): v for v in enum}}
        opts["resolutions"] = union(opts.get("resolutions", []), [str(v) for v in enum])
    # Duration
    if "duration" in kf:
        key = kf["duration"]
        spec = inputs.get(key) or {}
        enum = spec.get("values") or []
        if enum:
            sample = [str(v) for v in enum if str(v) != "auto"]
            suffix = "s" if sample and all(s.endswith("s") for s in sample) else None
            vals = [num(s[:-1] if suffix else s) for s in sample]
            vals = [v for v in vals if v is not None]
            dtype = "number" if spec.get("valueType") in ("integer", "number") else "string"
            fmap["duration"] = {"key": key, "type": dtype, **({"suffix": suffix} if suffix else {})}
            if len(vals) > 6:
                pick = [v for v in vals if v in (3, 4, 5, 6, 8, 10, 12, 15, 20, 30)] or vals[:6]
                # Keep the longest option: multi-shot budgets and the duration picker both need the real maximum.
                vals = pick[:6] + [pick[-1]] if len(pick) > 7 else pick
            opts["durations"] = union(opts.get("durations", []), vals)
        else:
            dtype = "number" if spec.get("type") in ("integer", "number") else "string"
            fmap["duration"] = {"key": key, "type": dtype}
            if str(spec.get("default", "")).endswith("s") and dtype == "string":
                fmap["duration"]["suffix"] = "s"
        if key.endswith("_ms"):
            fmap["duration"]["multiplier"] = 1000
    # Text-to-speech etc. carry the prompt in "text".
    if ropts.get("fixed"):
        m = {**m, "fixed": {**m["fixed"], **ropts["fixed"]}}
    if m["fixed"]:
        fmap["fixed"] = {k: v for k, v in m["fixed"].items() if k.split(".")[0] in inputs}
        missing = [k for k in m["fixed"] if k.split(".")[0] not in inputs]
        if missing:
            warn(f"{m['id']}: fixed fields {missing} not in {ep} inputs")
        if not fmap["fixed"]:
            del fmap["fixed"]
    if m.get("api_defaults"):
        fmap["defaults"] = {k: v for k, v in m["api_defaults"].items() if k.split(".")[0] in inputs}
        missing = [k for k in m["api_defaults"] if k.split(".")[0] not in inputs]
        if missing:
            warn(f"{m['id']}: default fields {missing} not in {ep} inputs")
        if not fmap["defaults"]:
            del fmap["defaults"]
    # Inputs the API requires that no canonical field fills: send the API's own documented default
    # (MiniMax H3 Max's prompt_expansion_mode), or warn when there is none to send.
    sent = set(map_fields(fmap)) | ({"prompt"} if "prompt" not in fmap else set())
    for k, spec in inputs.items():
        if not isinstance(spec, dict) or not spec.get("required") or k in sent:
            continue
        if spec.get("default") is not None:
            fmap.setdefault("defaults", {})[k] = spec["default"]
        else:
            warn(f"{m['id']}: {ep} requires {k}, which no field of this route fills")
    if "numOutputs" in fmap:
        mx = num((inputs.get(fmap["numOutputs"]) or {}).get("maximum")) or 4
        opts["maxOutputs"] = max(opts.get("maxOutputs", 1), min(4, mx))
    if "images" in fmap:
        mx = num((inputs.get(fmap["images"]) or {}).get("maxItems")) or None
        opts["maxImages"] = max(opts.get("maxImages", 1), mx or (10 if op == "edit" else 4))
    elif "image" in fmap:
        opts["maxImages"] = max(opts.get("maxImages", 0), 2 if "image2" in fmap else 1)
    # Inpaint routes say what the mask's paint means (edit routes get theirs when the inpaint route is derived).
    if op == "inpaint" and "mask" in fmap and mask_format(ep):
        fmap["maskFormat"] = mask_format(ep)
    route = {"op": op, "provider": provider, "endpoint": ep, "map": fmap}
    if ropts.get("note"):
        route["note"] = ropts["note"]
    if ropts.get("loraEndpoint"):
        if (provider, ropts["loraEndpoint"]) not in EPS:
            warn(f"{m['id']}: LoRA endpoint {ropts['loraEndpoint']} not in research")
        route["loraEndpoint"] = ropts["loraEndpoint"]
    return route, e


def parse_price(e):
    p = str(e.get("price") or "")
    m = re.search(r"\$(\d+(?:\.\d+)?)\s*(?:per|/)\s*(?:output\s+)?(image|images|second|seconds|video|videos|minute|minutes|megapixels|megapixel|"
                  r"generation|generations|request|requests|audios|audio file)\b", p)
    if not m:
        return None
    unit = {"images": "image", "seconds": "second", "minutes": "minute", "videos": "video", "megapixels": "megapixel", "generation": "request", "generations": "request",
            "requests": "request", "audios": "request", "audio file": "request"}.get(m.group(2), m.group(2))
    return {"unit": unit, "usd": float(m.group(1))}


out = []
for m in M:
    opts = {}
    routes = []
    first_e = None
    for r in m["routes"]:
        op, ep = r[0], r[1]
        provider = r[2] if len(r) > 2 else "fal"
        ropts = r[3] if len(r) > 3 and isinstance(r[3], dict) else {}
        res = build_route(op, ep, provider, m, opts, ropts)
        if not res:
            continue
        route, e = res
        first_e = first_e or e
        routes.append(route)
        # Edit endpoints that take a mask also get a native inpaint route.
        if op == "edit":
            inputs = e.get("inputs") or {}
            # The mask belongs on the inpaint route only; plain edits never send one.
            mk = route["map"].pop("mask", None) or next((k for k in ("mask_url", "mask_image_url", "mask") if k in inputs and inputs[k].get("type") != "array"), None)
            if mk:
                fmt = mask_format(ep)
                routes.append({**route, "op": "inpaint", "map": {**route["map"], "mask": mk, **({"maskFormat": fmt} if fmt else {})}})
        if len(r) > 3 and r[3] == "+flf2v" and not ropts:
            if "endImage" in route["map"]:
                routes.append({**route, "op": "flf2v"})
            else:
                warn(f"{m['id']}: {ep} has no end frame field; skipping flf2v")
    if not routes:
        warn(f"{m['id']}: no routes, skipping model")
        continue
    # No route sends a prompt (try-on, 3D, transcription): planning and the composer don't ask for one.
    if all(r["map"].get("prompt") is False for r in routes):
        opts["promptless"] = True
    opts.update(m["options"])
    pricing = None
    if m["pricing"]:
        u, usd, *note = m["pricing"]
        pricing = {"unit": u, "usd": usd, **({"note": note[0]} if note else {})}
    elif first_e:
        pricing = parse_price(first_e)
    d = {
        "id": m["id"], "name": m["name"], "vendor": m["vendor"], "family": m["family"], "engine": "cloud",
        "kind": m["kind"], "tagline": m["tagline"], "routes": routes, "options": opts,
    }
    if m["badges"]:
        d["badges"] = m["badges"]
    defaults = {k: v for k, v in m["defaults"].items()}
    # Drop defaults the model can't take.
    if "aspectRatio" in defaults and defaults["aspectRatio"] not in opts.get("aspectRatios", [defaults["aspectRatio"]]):
        defaults["aspectRatio"] = opts["aspectRatios"][0]
    if "resolution" in defaults and opts.get("resolutions") and defaults["resolution"] not in opts["resolutions"]:
        defaults["resolution"] = opts["resolutions"][0]
    if "duration" in defaults and opts.get("durations") and defaults["duration"] not in opts["durations"]:
        defaults["duration"] = opts["durations"][0]
    if opts.get("audio"):
        defaults.setdefault("generateAudio", True)
    if defaults:
        d["defaults"] = defaults
    if pricing:
        d["pricing"] = pricing
    if m["hidden"]:
        d["hidden"] = True
    out.append(d)

ts = (
    "// Generated by scripts/gen-cloud-models.py from docs/research/paid-model-apis(-2,-3).json — do not edit by hand.\n"
    'import type { ModelDef } from "./types";\n\n'
    f"export const CLOUD_MODELS: ModelDef[] = {json.dumps(out, indent=2)};\n"
)
(ROOT / "src/lib/catalog/cloud-models.generated.ts").write_text(ts)
print(f"wrote {len(out)} cloud models")
