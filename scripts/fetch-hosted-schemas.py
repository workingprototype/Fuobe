#!/usr/bin/env python3
"""
Research helper (needs the network; not part of gen:catalog): read the input schemas of the hosted
open-weight endpoints the catalog routes LoRAs to, and store them in
docs/research/fuobe-originals-recipes-5.json in the same shape as paid-model-apis*.json `inputs`:

- hostedLoraEndpoints[<id>].inputs / keyFields / output  for the LoRA endpoints in LORA (fal OpenAPI,
  or the schema embedded in a Replicate model page, pinned to the research's version);
- hostedBaseEndpoints[]  for the plain endpoints of the same models that no earlier research file
  has (LTX-2.3 22B, FLUX.2 [klein] 4B), with their price from fal's llms.txt.

keyFields (which input is the prompt, the image, the clip…) are this script's curation, as in the
earlier research files. scripts/gen-cloud-models.py reads both lists.

Run:  python3 scripts/fetch-hosted-schemas.py
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
    "fal-ai/qwen-image-2512/lora": T2I,
    "prunaai/z-image-turbo-lora": {"prompt": "prompt", "width": "width", "height": "height", "seed": "seed"},
}
BASE = {
    "fal-ai/ltx-2.3-22b/image-to-video": ("i2v", {**{k: v for k, v in LTX.items() if k != "loras"}, "image": "image_url", "endImage": "end_image_url"}),
    "fal-ai/ltx-2.3-22b/text-to-video": ("t2v", {k: v for k, v in LTX.items() if k != "loras"}),
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


def main():
    raw = FILE.read_text(encoding="utf-8")
    data = json.loads(raw)
    by_id = {e["id"]: e for e in data["hostedLoraEndpoints"]}
    for ep, kf in LORA.items():
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
