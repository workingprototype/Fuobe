#!/usr/bin/env python3
"""
Generate src/lib/catalog/cloud-models.generated.ts from docs/research/paid-model-apis.json.

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


def model(id, name, vendor, family, kind, tagline, routes, badges=None, pricing=None, defaults=None, options=None, fixed=None, hidden=False):
    M.append(dict(id=id, name=name, vendor=vendor, family=family, kind=kind, tagline=tagline, routes=routes,
                  badges=badges or [], pricing=pricing, defaults=defaults or {}, options=options or {}, fixed=fixed or {}, hidden=hidden))


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
model("recraft-4-1", "Recraft V4.1", "Recraft", "recraft", "image",
      "Brand-ready illustration, icons and design assets",
      [("t2i", "fal-ai/recraft/v4.1/text-to-image")], defaults={"aspectRatio": "1:1"})
model("qwen-image-3", "Qwen Image 3", "Alibaba Qwen", "qwen-image", "image",
      "Hosted Qwen with superb bilingual text rendering",
      [("t2i", "alibaba/qwen-image-3/text-to-image"), ("edit", "alibaba/qwen-image-3/edit")], defaults={"aspectRatio": "1:1"})
model("wan-2-7-image", "Wan 2.7 Image", "Alibaba Wan", "wan", "image",
      "Wan's image model — cinematic stills that animate well",
      [("t2i", "fal-ai/wan/v2.7/pro/text-to-image"), ("edit", "fal-ai/wan/v2.7/pro/edit")], defaults={"aspectRatio": "16:9"})
model("z-image-turbo-cloud", "Z-Image Turbo (hosted)", "Alibaba Tongyi", "z-image", "image",
      "Sub-second photoreal images",
      [("t2i", "fal-ai/z-image/turbo")], badges=["fast"], defaults={"aspectRatio": "1:1"})
model("imagen-4", "Imagen 4", "Google", "imagen", "image", "Google's photoreal text-to-image",
      [("t2i", "google/imagen-4", "replicate")], defaults={"aspectRatio": "1:1"})

# ----- Video
model("seedance-2-5", "Seedance 2.5", "ByteDance", "seedance", "video",
      "Higgsfield's default — multi-shot cinema with native audio, up to 30s",
      [("t2v", "bytedance/seedance-2.5/text-to-video"), ("i2v", "bytedance/seedance-2.5/image-to-video", "fal", "+flf2v"),
       ("ref2v", "bytedance/seedance-2.5/reference-to-video")],
      badges=["top", "audio", "new"], pricing=("second", 0.473, "720p"), defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "720p"})
model("seedance-2-0", "Seedance 2.0", "ByteDance", "seedance", "video",
      "Smooth multi-shot motion with audio",
      [("t2v", "bytedance/seedance-2.0/text-to-video"), ("i2v", "bytedance/seedance-2.0/image-to-video", "fal", "+flf2v"),
       ("ref2v", "bytedance/seedance-2.0/reference-to-video")],
      badges=["audio"], defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "720p"})
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
model("kling-motion-control", "Kling 3.0 Motion Control", "Kuaishou", "kling", "video",
      "Copy the motion of a reference video onto your character",
      [("motion-transfer", "fal-ai/kling-video/v3/pro/motion-control")], defaults={})
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
       ("ref2v", "fal-ai/veo3.1/reference-to-video"), ("t2v", "google/veo-3.1", "replicate"), ("i2v", "google/veo-3.1", "replicate")],
      badges=["top", "audio", "hd"], pricing=("second", 0.4, "audio-off-half"), defaults={"aspectRatio": "16:9", "duration": 8, "resolution": "1080p"})
model("veo-3-1-fast", "Veo 3.1 Fast", "Google", "veo", "video", "Veo quality at a fraction of the cost",
      [("t2v", "fal-ai/veo3.1/fast"), ("i2v", "fal-ai/veo3.1/fast/image-to-video"), ("flf2v", "fal-ai/veo3.1/fast/first-last-frame-to-video")],
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
       ("ref2v", "fal-ai/wan/v2.7/reference-to-video"), ("v2v", "fal-ai/wan/v2.7/edit-video")],
      badges=["audio"], defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "1080p"})
model("wan-2-6", "Wan 2.6", "Alibaba Wan", "wan", "video", "Multi-shot Wan with audio",
      [("t2v", "wan/v2.6/text-to-video"), ("i2v", "wan/v2.6/image-to-video"), ("ref2v", "wan/v2.6/reference-to-video")],
      badges=["audio"], defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "1080p"})
model("wan-2-5", "Wan 2.5", "Alibaba Wan", "wan", "video", "Audio-driven video up to 1080p",
      [("t2v", "fal-ai/wan-25-preview/text-to-video"), ("i2v", "fal-ai/wan-25-preview/image-to-video")],
      badges=["audio"], pricing=("second", 0.15, "1080p"), defaults={"aspectRatio": "16:9", "duration": 5, "resolution": "1080p"})
model("minimax-h3", "MiniMax H3", "MiniMax", "hailuo", "video", "Expressive characters and dynamic action",
      [("t2v", "minimax/h3/text-to-video"), ("i2v", "minimax/h3/image-to-video", "fal", "+flf2v"), ("ref2v", "minimax/h3/reference-to-video")],
      badges=["new"], defaults={"aspectRatio": "16:9"})
model("minimax-h3-max", "MiniMax H3 Max", "MiniMax", "hailuo", "video", "Top-tier MiniMax with extend",
      [("t2v", "minimax/h3-max/text-to-video"), ("i2v", "minimax/h3-max/image-to-video", "fal", "+flf2v"), ("ref2v", "minimax/h3-max/reference-to-video")],
      badges=["pro"], defaults={"aspectRatio": "16:9"})
model("hailuo-2-3", "MiniMax Hailuo 2.3", "MiniMax", "hailuo", "video", "Expressive characters and dynamic action",
      [("t2v", "fal-ai/minimax/hailuo-2.3/pro/text-to-video"), ("i2v", "fal-ai/minimax/hailuo-2.3/pro/image-to-video")],
      pricing=("video", 0.49), defaults={"duration": 6}, fixed={"prompt_optimizer": True})
model("hailuo-02", "MiniMax Hailuo 02", "MiniMax", "hailuo", "video", "Physics-heavy shots with start & end frames",
      [("t2v", "fal-ai/minimax/hailuo-02/standard/text-to-video"), ("i2v", "fal-ai/minimax/hailuo-02/standard/image-to-video", "fal", "+flf2v")],
      pricing=("second", 0.045), defaults={"duration": 6, "resolution": "768P"}, fixed={"prompt_optimizer": True})
model("flux-3-video", "FLUX.3 Video", "Black Forest Labs", "flux", "video", "BFL's video model with keyframes and edits",
      [("t2v", "blackforestlabs/flux-3/text-to-video"), ("i2v", "blackforestlabs/flux-3/image-to-video"),
       ("flf2v", "blackforestlabs/flux-3/first-last-frame-to-video"), ("v2v", "blackforestlabs/flux-3/edit-video")],
      badges=["new"], defaults={"aspectRatio": "16:9"})
model("ltx-2-5", "LTX 2.5 Pro", "Lightricks", "ltx", "video", "Fast 4K-capable video with audio",
      [("t2v", "lightricks/ltx-2.5/text-to-video/pro"), ("i2v", "lightricks/ltx-2.5/image-to-video/pro")],
      badges=["audio"], defaults={"aspectRatio": "16:9"})
model("pixverse-v6", "PixVerse V6", "PixVerse", "pixverse", "video", "Stylized social video with transitions",
      [("t2v", "fal-ai/pixverse/v6/text-to-video"), ("i2v", "fal-ai/pixverse/v6/image-to-video"), ("flf2v", "fal-ai/pixverse/v6/transition")],
      defaults={"aspectRatio": "16:9"})
model("vidu-q3", "Vidu Q3", "Shengshu", "vidu", "video", "Anime-friendly video with references",
      [("t2v", "fal-ai/vidu/q3/text-to-video"), ("i2v", "fal-ai/vidu/q3/image-to-video"), ("ref2v", "fal-ai/vidu/q3/reference-to-video/mix")],
      defaults={"aspectRatio": "16:9"})
model("luma-ray-3-2", "Luma Ray 3.2", "Luma", "luma", "video", "HDR, physically convincing motion",
      [("t2v", "luma/agent/ray/v3.2/text-to-video"), ("i2v", "luma/agent/ray/v3.2/image-to-video"), ("v2v", "luma/agent/ray/v3.2/video-to-video")],
      defaults={"aspectRatio": "16:9"})

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
model("elevenlabs-tts", "ElevenLabs v3", "ElevenLabs", "elevenlabs", "audio", "Expressive multilingual speech",
      [("tts", "fal-ai/elevenlabs/tts/eleven-v3")], pricing=("request", 0.1, "per 1k chars"), fixed={"voice": "Rachel"})
model("elevenlabs-sfx", "ElevenLabs Sound Effects", "ElevenLabs", "elevenlabs", "audio", "Describe a sound, get a sound",
      [("sfx", "fal-ai/elevenlabs/sound-effects/v2")], pricing=("second", 0.002), defaults={"duration": 5}, options={"durations": [2, 5, 10, 22]})
model("elevenlabs-music", "ElevenLabs Music", "ElevenLabs", "elevenlabs", "audio", "Studio-quality songs from a prompt",
      [("music", "fal-ai/elevenlabs/music")], pricing=("minute", 0.6), defaults={"duration": 30}, options={"durations": [15, 30, 60, 120]})
model("mmaudio-cloud", "MMAudio", "hkchengrex", "mmaudio", "video", "Add matching sound to a silent video",
      [("v2a", "fal-ai/mmaudio-v2")], pricing=("second", 0.001))


# ---------------------------------------------------------------------------

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


def build_route(op, ep, provider, m, opts):
    e = EPS.get((provider, ep))
    if not e:
        warn(f"{m['id']}: endpoint {provider}:{ep} not in research")
        return None
    if not e.get("verified"):
        warn(f"{m['id']}: {ep} is not verified")
    inputs = e.get("inputs") or {}
    kf = dict(e.get("keyFields") or {})
    fmap = {}
    # Prompt
    if "prompt" in kf:
        if kf["prompt"] != "prompt":
            fmap["prompt"] = kf["prompt"]
    else:
        fmap["prompt"] = False
    for k in ["negativePrompt", "image", "images", "endImage", "mask", "video", "audio", "numOutputs", "seed", "generateAudio"]:
        if k in kf:
            if k in ("video", "audio", "image", "endImage", "mask") and (inputs.get(kf[k]) or {}).get("type") == "array":
                continue  # array-of-media inputs (reference videos/audios) aren't wired yet
            fmap[k] = kf[k]
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
                vals = pick[:7]
            opts["durations"] = union(opts.get("durations", []), vals)
        else:
            dtype = "number" if spec.get("type") in ("integer", "number") else "string"
            fmap["duration"] = {"key": key, "type": dtype}
            if str(spec.get("default", "")).endswith("s") and dtype == "string":
                fmap["duration"]["suffix"] = "s"
        if key.endswith("_ms"):
            fmap["duration"]["multiplier"] = 1000
    # Text-to-speech etc. carry the prompt in "text".
    if m["fixed"]:
        fmap["fixed"] = {k: v for k, v in m["fixed"].items() if k in inputs}
        missing = [k for k in m["fixed"] if k not in inputs]
        if missing:
            warn(f"{m['id']}: fixed fields {missing} not in {ep} inputs")
        if not fmap["fixed"]:
            del fmap["fixed"]
    if "numOutputs" in fmap:
        mx = num((inputs.get(fmap["numOutputs"]) or {}).get("maximum")) or 4
        opts["maxOutputs"] = max(opts.get("maxOutputs", 1), min(4, mx))
    if "images" in fmap:
        mx = num((inputs.get(fmap["images"]) or {}).get("maxItems")) or None
        opts["maxImages"] = max(opts.get("maxImages", 1), mx or (10 if op == "edit" else 4))
    elif "image" in fmap:
        opts["maxImages"] = max(opts.get("maxImages", 0), 1)
    return {"op": op, "provider": provider, "endpoint": ep, "map": fmap}, e


def parse_price(e):
    p = str(e.get("price") or "")
    m = re.search(r"\$(\d+(?:\.\d+)?)\s*(?:per|/)\s*(?:output\s+)?(image|images|second|seconds|video|minute|minutes|megapixel)", p)
    if not m:
        return None
    unit = {"images": "image", "seconds": "second", "minutes": "minute"}.get(m.group(2), m.group(2))
    return {"unit": unit, "usd": float(m.group(1))}


out = []
for m in M:
    opts = {}
    routes = []
    first_e = None
    for r in m["routes"]:
        op, ep = r[0], r[1]
        provider = r[2] if len(r) > 2 else "fal"
        res = build_route(op, ep, provider, m, opts)
        if not res:
            continue
        route, e = res
        first_e = first_e or e
        routes.append(route)
        if len(r) > 3 and r[3] == "+flf2v":
            if "endImage" in route["map"]:
                routes.append({**route, "op": "flf2v"})
            else:
                warn(f"{m['id']}: {ep} has no end frame field; skipping flf2v")
    if not routes:
        warn(f"{m['id']}: no routes, skipping model")
        continue
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
    "// Generated by scripts/gen-cloud-models.py from docs/research/paid-model-apis.json — do not edit by hand.\n"
    'import type { ModelDef } from "./types";\n\n'
    f"export const CLOUD_MODELS: ModelDef[] = {json.dumps(out, indent=2)};\n"
)
(ROOT / "src/lib/catalog/cloud-models.generated.ts").write_text(ts)
print(f"wrote {len(out)} cloud models")
