#!/usr/bin/env python3
"""
Research helper (needs the network; not part of gen:catalog): read the input schemas of the hosted
open-weight endpoints the catalog routes LoRAs to, and store them in
docs/research/fuobe-originals-recipes-5.json in the same shape as paid-model-apis*.json `inputs`:

- hostedLoraEndpoints[<id>].inputs / keyFields / output  for the LoRA endpoints in LORA (fal OpenAPI,
  or the schema embedded in a Replicate model page, pinned to the research's version);
- hostedBaseEndpoints[]  for the plain endpoints of the same models that no earlier research file
  has (LTX-2.3 22B t2v / i2v / extend / v2v, FLUX.2 [klein] 4B), with their price from fal's llms.txt.

keyFields (which input is the prompt, the image, the clip…) are this script's curation, as in the
earlier research files. scripts/gen-cloud-models.py reads both lists.

- trainers[<id>].loraOutput  for fal's LoRA trainers (--trainers): the response fields that hold the trained
  LoRA files (diffusers_lora_file, lora_file, or Wan 2.2's pair with high_noise_lora), read from each
  trainer's OpenAPI output schema, so src/server/training.ts knows where a finished training's LoRA is.

Run:  python3 scripts/fetch-hosted-schemas.py
      python3 scripts/fetch-hosted-schemas.py --only fal-ai/z-image/turbo/image-to-image/lora   (one endpoint, the rest kept)
      python3 scripts/fetch-hosted-schemas.py --trainers                                         (only the trainers' outputs)
"""
import datetime
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILE = ROOT / "docs/research/fuobe-originals-recipes-5.json"
TODAY = datetime.date.today().isoformat()

# Canonical slots → field names, per endpoint (Fuobe's names: see FieldMap in src/lib/catalog/types.ts).
T2I = {"prompt": "prompt", "negativePrompt": "negative_prompt", "aspectRatio": "image_size", "seed": "seed", "numOutputs": "num_images", "loras": "loras"}
EDIT = {**T2I, "images": "image_urls"}
LTX = {"prompt": "prompt", "negativePrompt": "negative_prompt", "aspectRatio": "video_size", "seed": "seed", "generateAudio": "generate_audio", "numFrames": "num_frames", "fps": "fps", "loras": "loras"}
KLEIN = {k: v for k, v in T2I.items() if k != "negativePrompt"}
LORA = {
    "fal-ai/qwen-image-edit-2511/lora": EDIT,
    # Qwen-Image-Edit 2509 with its LoRAs: Fuobe DoP relights a start frame with the 2509 Relight LoRA (o/dop).
    "fal-ai/qwen-image-edit-plus-lora": EDIT,
    "fal-ai/flux-2/klein/4b/lora": KLEIN,
    "fal-ai/flux-2/klein/4b/edit/lora": {**KLEIN, "images": "image_urls"},
    "fal-ai/ltx-2.3-22b/image-to-video/lora": {**LTX, "image": "image_url", "endImage": "end_image_url"},
    "fal-ai/ltx-2.3-22b/text-to-video/lora": LTX,
    "fal-ai/ltx-2.3-22b/video-to-video/lora": {**LTX, "video": "video_url"},
    "fal-ai/ltx-2.3-22b/extend-video/lora": {**LTX, "video": "video_url", "endImage": "end_image_url"},
    "fal-ai/wan/v2.2-a14b/image-to-video/lora": {"prompt": "prompt", "image": "image_url", "endImage": "end_image_url", "negativePrompt": "negative_prompt",
                                                 "aspectRatio": "aspect_ratio", "resolution": "resolution", "numFrames": "num_frames", "seed": "seed", "loras": "loras"},
    "fal-ai/wan/v2.2-a14b/text-to-video/lora": {"prompt": "prompt", "negativePrompt": "negative_prompt", "aspectRatio": "aspect_ratio", "resolution": "resolution",
                                                "numFrames": "num_frames", "seed": "seed", "loras": "loras"},
    "fal-ai/wan/v2.2-a14b/text-to-image/lora": {"prompt": "prompt", "negativePrompt": "negative_prompt", "aspectRatio": "image_size", "seed": "seed", "loras": "loras"},
    "fal-ai/z-image/turbo/lora": {k: v for k, v in T2I.items() if k != "negativePrompt"},
    # Fuobe Soul's edit route (O2): image-to-image with the look's LoRAs; image_size "auto" keeps the picture's shape.
    "fal-ai/z-image/turbo/image-to-image/lora": {**{k: v for k, v in T2I.items() if k not in ("negativePrompt", "aspectRatio")}, "image": "image_url"},
    "fal-ai/qwen-image-2512/lora": T2I,
    "prunaai/z-image-turbo-lora": {"prompt": "prompt", "width": "width", "height": "height", "seed": "seed"},
    # Soul ID on every base fal trains (O3, o/soul-id): the models a LoRA trained on FLUX.1 [dev], FLUX.1 Krea [dev],
    # FLUX.2 [dev], Krea 2 or FLUX.2 [klein] 9B runs on. Their licences are recorded as information, never a gate
    # (the owner's decision of 2026-10-27: the admin turns models on or off in Settings).
    "fal-ai/flux-lora": KLEIN,
    "fal-ai/flux-krea-lora": KLEIN,
    "fal-ai/flux-2/lora": KLEIN,
    "fal-ai/krea-2/turbo/lora": KLEIN,
    "fal-ai/flux-2/klein/9b/lora": KLEIN,
}
BASE = {
    "fal-ai/ltx-2.3-22b/image-to-video": ("i2v", {**{k: v for k, v in LTX.items() if k != "loras"}, "image": "image_url", "endImage": "end_image_url"}),
    "fal-ai/ltx-2.3-22b/text-to-video": ("t2v", {k: v for k, v in LTX.items() if k != "loras"}),
    # Read so their routes send num_frames (the length picked), as the /lora variants do.
    # Extend keeps the clip's own size (video_size "auto"), so no aspect ratio is mapped.
    "fal-ai/ltx-2.3-22b/extend-video": ("extend", {**{k: v for k, v in LTX.items() if k not in ("loras", "aspectRatio")}, "video": "video_url", "endImage": "end_image_url"}),
    "fal-ai/ltx-2.3-22b/video-to-video": ("v2v", {**{k: v for k, v in LTX.items() if k != "loras"}, "video": "video_url"}),
    "fal-ai/flux-2/klein/4b": ("t2i", {k: v for k, v in KLEIN.items() if k != "loras"}),
    "fal-ai/flux-2/klein/4b/edit": ("edit", {**{k: v for k, v in KLEIN.items() if k != "loras"}, "images": "image_urls"}),
}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "fuobe-research/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8")


def resolve(schema, root):
    while isinstance(schema, dict) and "$ref" in schema:
        name = schema["$ref"].split("/")[-1]
        schema = root["components"]["schemas"][name]
    return schema


def spec(p, root, required=False):
    """One OpenAPI property in the research files' shape (type, values, default, minimum…, desc)."""
    p = resolve(p, root)
    out = {}
    variants = p.get("anyOf") or p.get("oneOf")
    if variants:
        real = [resolve(v, root) for v in variants if resolve(v, root).get("type") != "null"]
        if len(real) < len(variants):
            out["nullable"] = True
        if len(real) == 1:
            out.update(spec({**real[0], **{k: v for k, v in p.items() if k not in ("anyOf", "oneOf")}}, root))
        else:
            out["type"] = "union"
            out["variants"] = [spec(v, root) for v in real]
    elif "enum" in p:
        out.update({"type": "enum", "values": p["enum"], "valueType": p.get("type", "string")})
    elif p.get("type") == "array":
        items = resolve(p.get("items") or {}, root)
        out["type"] = "array"
        if items.get("type") == "object" or "properties" in items:
            out["items"] = "object"
            out["itemSchema"] = {k: spec(v, root) for k, v in (items.get("properties") or {}).items()}
            if items.get("required"):
                out["itemRequired"] = items["required"]
        else:
            out["items"] = items.get("type", "string")
        for k in ("minItems", "maxItems"):
            if k in p:
                out[k] = p[k]
    elif p.get("type") == "object" or "properties" in p:
        out["type"] = "object"
        out["fields"] = {k: spec(v, root) for k, v in (p.get("properties") or {}).items()}
    else:
        out["type"] = p.get("type", "string") + (f"({p['format']})" if p.get("format") == "uri" else "")
    if required:
        out["required"] = True
    elif "type" in out and out["type"] not in ("union",) and "required" not in out:
        out["required"] = False
    for src, dst in (("default", "default"), ("minimum", "minimum"), ("maximum", "maximum"), ("exclusiveMinimum", "minimumExclusive"), ("exclusiveMaximum", "maximumExclusive")):
        if src in p:
            out[dst] = p[src]
    if p.get("nullable"):
        out["nullable"] = True
    if p.get("description"):
        out["desc"] = p["description"]
    if p.get("examples"):
        out["examples"] = p["examples"][:1]
    return out


def inputs_of(root, schema):
    schema = resolve(schema, root)
    req = set(schema.get("required") or [])
    order = schema.get("x-fal-order-properties") or sorted(schema.get("properties") or {}, key=lambda k: (schema["properties"][k].get("x-order", 999), k))
    props = schema.get("properties") or {}
    return {k: spec(props[k], root, k in req) for k in order if k in props}


def fal(endpoint):
    root = json.loads(get(f"https://fal.ai/api/openapi/queue/openapi.json?endpoint_id={endpoint}"))
    post = root["paths"][f"/{endpoint}"]["post"]
    schema = post["requestBody"]["content"]["application/json"]["schema"]
    return inputs_of(root, schema)


def replicate(slug, version):
    page = get(f"https://replicate.com/{slug}/api/schema")
    for m in re.finditer(r'<script[^>]*type="application/json"[^>]*>(.*?)</script>', page, re.S):
        try:
            data = json.loads(m.group(1))
        except json.JSONDecodeError:
            continue
        v = data.get("version") if isinstance(data, dict) else None
        if isinstance(v, dict) and v.get("id") == version:
            root = v["_extras"]["dereferenced_openapi_schema"]
            return inputs_of(root, root["components"]["schemas"]["Input"])
    raise SystemExit(f"{slug}: version {version} not found on its schema page")


def fal_price(endpoint):
    text = get(f"https://fal.ai/models/{endpoint}/llms.txt")
    m = re.search(r"(?im)^.*\$\d[^\n]*$", text)
    return re.sub(r"^(Price:\s*)", "", m.group(0).replace("**", "").strip(" -*")) if m else None


def trainer_outputs(data):
    """Record which response fields of each fal trainer hold LoRA files (File fields named *lora*)."""
    for t in data["trainers"]:
        if t.get("provider") != "fal":
            continue
        ep = t["id"]
        root = json.loads(get(f"https://fal.ai/api/openapi/queue/openapi.json?endpoint_id={ep}"))
        result = root["paths"][f"/{ep}/requests/{{request_id}}"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]
        props = resolve(result, root).get("properties") or {}
        files = []
        for name, p in props.items():
            refs = [p] + list(p.get("anyOf") or p.get("allOf") or [])
            if any(resolve(r, root).get("title") == "File" or str(r.get("$ref", "")).endswith("/File") for r in refs if isinstance(r, dict)):
                # Configs, debug datasets and validation samples (LTX's video / audio) aren't LoRAs.
                if "lora" in name:
                    files.append(name)
        t["loraOutput"] = files
        t["outputChecked"] = TODAY
        print(f"{ep}: {files}")


def main():
    raw = FILE.read_text(encoding="utf-8")
    data = json.loads(raw)
    if "--trainers" in sys.argv:
        trainer_outputs(data)
        FILE.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        return
    by_id = {e["id"]: e for e in data["hostedLoraEndpoints"]}
    only = sys.argv[sys.argv.index("--only") + 1:] if "--only" in sys.argv else None
    for ep, kf in LORA.items():
        if only and ep not in only:
            continue
        rec = by_id.get(ep)
        if not rec:
            sys.exit(f"{ep} is not in hostedLoraEndpoints")
        rec["inputs"] = replicate(ep, rec["version"]) if rec["provider"] == "replicate" else fal(ep)
        missing = [f for f in kf.values() if f not in rec["inputs"]]
        if missing:
            sys.exit(f"{ep}: keyFields {missing} are not inputs")
        rec["keyFields"] = kf
        rec["output"] = "images[].url" if rec["op"] in ("t2i", "edit") else "video.url"
        if rec["provider"] == "replicate":
            rec["output"] = "output[]"
        rec["inputsChecked"] = TODAY
        print(f"{ep}: {len(rec['inputs'])} inputs")
    if only:
        FILE.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        return
    base = []
    for ep, (op, kf) in BASE.items():
        inputs = fal(ep)
        missing = [f for f in kf.values() if f not in inputs]
        if missing:
            sys.exit(f"{ep}: keyFields {missing} are not inputs")
        base.append({"provider": "fal", "endpoint": ep, "operation": op, "status": "active", "inputs": inputs, "keyFields": kf,
                     "output": "images[].url" if op in ("t2i", "edit") else "video.url", "price": fal_price(ep), "verified": True,
                     "schemaUrl": f"https://fal.ai/api/openapi/queue/openapi.json?endpoint_id={ep}", "checked": TODAY})
        print(f"{ep}: {len(inputs)} inputs")
    data["hostedBaseEndpoints"] = base
    FILE.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
