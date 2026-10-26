#!/usr/bin/env python3
"""
Generate src/lib/catalog/trainers.generated.ts: the hosted LoRA trainers Fuobe Soul ID and personal moodboards
can run in the cloud (build plan O3), with each one's request fields, its price per step and the licence of the
weights it trains on.
Source: docs/research/fuobe-originals-recipes-5.json → trainers[] (read from fal's OpenAPI and llms.txt).

Only fal's image trainers are generated (their data is a zip of 001.jpg + 001.txt caption pairs in
`image_data_url`): video trainers (Wan, LTX) and Replicate's GPU-time trainers aren't Soul ID routes.
src/lib/catalog/training.ts turns a training target into a request with these fields, so nothing about a
trainer's API is typed by hand.

Fails (exit 1) when a trainer Fuobe's targets use (USED below):
- trains on weights that aren't commercial (a default must be commercial-safe), or isn't active / served;
- lacks a field its request sends (steps, default_caption, learning_rate; training_type for a style trainer);
- has a price this script can't read (the spend shown before a run, and the eval harness's cap, need it).

Run:  python3 scripts/gen-trainers.py
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = json.loads((ROOT / "docs/research/fuobe-originals-recipes-5.json").read_text(encoding="utf-8"))
OUT = ROOT / "src/lib/catalog/trainers.generated.ts"

# The trainers src/lib/catalog/training.ts uses, and the fields each request sends.
USED = {
    "fal-ai/z-image-turbo-trainer-v2": ["steps", "default_caption", "learning_rate"],
    "fal-ai/z-image-trainer": ["steps", "default_caption", "learning_rate", "training_type"],
    "fal-ai/qwen-image-2512-trainer": ["steps", "default_caption", "learning_rate"],
}
errors = []


def slug(s):
    """'Z-Image Turbo' → 'z-image-turbo', 'Z-Image (base)' → 'z-image', 'Qwen-Image 2512' → 'qwen-image-2512'."""
    s = re.sub(r"\(base\)", "", s, flags=re.I)
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", s.lower()))


def num(s):
    v = float(s.replace(",", ""))
    return int(v) if v.is_integer() else v


def field(spec):
    """'integer default=2000 minimum=10 maximum=40000' → {type, default, min, max}; enums kept."""
    parts = spec.split(" ", 1)
    out = {"type": parts[0]}
    rest = parts[1] if len(parts) > 1 else ""
    m = re.search(r"enum=(\[.*?\])", rest)
    if m:
        out["enum"] = json.loads(m.group(1))
        rest = rest.replace(m.group(0), "")
    m = re.search(r'default=("[^"]*"|\S+)', rest)
    if m:
        raw = m.group(1)
        out["default"] = json.loads(raw) if raw.startswith('"') else (raw == "true" if raw in ("true", "false") else num(raw))
    for key, name in (("minimum", "min"), ("maximum", "max")):
        m = re.search(rf"{key}=(\S+)", rest)
        if m:
            out[name] = num(m.group(1))
    return out


def pricing(text):
    """The price per step and the fewest steps billed, from fal's own sentence (None when it names neither)."""
    t = text or ""
    per = None
    for pat, div in (
        (r"\$([\d.,]+) per 1000-step", 1000),
        (r"\$([\d.,]+) for 1,000 requested steps", 1000),
        (r"\$([\d.,]+) per steps?\b", 1),
        (r"([\d.]+) \* steps", 1),
    ):
        m = re.search(pat, t)
        if m:
            per = float(m.group(1).replace(",", "")) / div
            break
    if per is None:
        return None
    floor = 1
    for pat in (r"(\d[\d,]*) step floor", r"minimum of (\d[\d,]*) steps", r"(\d[\d,]*) steps is the minimum"):
        m = re.search(pat, t)
        if m:
            floor = int(m.group(1).replace(",", ""))
            break
    m = re.search(r"minimum charge of \$([\d.,]+)", t)
    if m and floor == 1:
        floor = round(float(m.group(1).replace(",", "")) / per)
    return {"usdPerStep": round(per, 8), "minBilledSteps": floor}


trainers = []
for raw in DATA["trainers"]:
    if raw.get("provider") != "fal" or "image_data_url" not in (raw.get("required") or []):
        continue
    tid = raw["id"]
    price = pricing(raw.get("price"))
    fields = {k: field(v) for k, v in sorted((raw.get("fields") or {}).items())}
    status = raw.get("status") or ""
    entry = {
        "id": tid,
        "provider": "fal",
        "family": raw.get("family") or "",
        "base": slug(raw.get("family") or ""),
        "role": raw.get("role") or "",
        "dataField": "image_data_url",
        "fields": fields,
        "licence": raw.get("baseLicence") or "",
        "commercial": bool(raw.get("commercialWeights")),
        "status": "active" if status == "active" else "unlisted" if status.startswith("unlisted") else status or "unknown",
        "checked": raw.get("checked") or "",
        "schemaUrl": raw.get("schemaUrl") or "",
        "priceText": raw.get("price") or "",
    }
    if price:
        entry.update(price)
    if tid in USED:
        if not entry["commercial"]:
            errors.append(f"{tid}: trains on non-commercial weights ({entry['licence']}), so no Fuobe Soul ID target may use it")
        if entry["status"] not in ("active", "unlisted"):
            errors.append(f"{tid}: status {status!r}")
        for f in USED[tid]:
            if f not in fields:
                errors.append(f"{tid}: has no {f} field")
        if not price:
            errors.append(f"{tid}: can't read its price from {raw.get('price')!r}")
    elif not price:
        # Not used by a target: kept without a price (the UI never offers it).
        pass
    trainers.append(entry)

missing = sorted(set(USED) - {t["id"] for t in trainers})
for tid in missing:
    errors.append(f"{tid}: not in the research's trainers[]")

if errors:
    print("gen-trainers: the research breaks the Soul ID rules:", file=sys.stderr)
    for e in errors:
        print(f"  - {e}", file=sys.stderr)
    sys.exit(1)

ts = (
    "// Generated by scripts/gen-trainers.py from docs/research/fuobe-originals-recipes-5.json — do not edit by hand.\n"
    'import type { HostedTrainer } from "./training";\n\n'
    "/** When the trainers' schemas and prices were read. */\n"
    f"export const TRAINERS_AS_OF = {json.dumps(DATA['asOf'])};\n\n"
    "/** fal's image LoRA trainers (a zip of 001.jpg + 001.txt pairs in image_data_url), with their fields and prices. */\n"
    f"export const HOSTED_TRAINERS: HostedTrainer[] = {json.dumps(trainers, indent=2, ensure_ascii=False)};\n"
)
OUT.write_text(ts, encoding="utf-8")
print(f"wrote {OUT.relative_to(ROOT)}: {len(trainers)} trainers ({len(USED)} used by Soul ID)")
