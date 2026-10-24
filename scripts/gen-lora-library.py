#!/usr/bin/env python3
"""
Generate src/lib/catalog/lora-library.generated.ts: every LoRA the Fuobe Originals use, with its pinned
download, unique local file name and a licence snapshot, plus the motion / effect preset → LoRA map.
Source: docs/research/fuobe-originals-recipes-5.json (loraLibrary, presets, motionsEffects).

The LoRA files are never committed: src/server/loras.ts downloads them (pinned civitai versions,
Hugging Face files) into ComfyUI's loras folder, or mirrors them for the cloud engine.

Fails (exit 1) when an entry breaks the licence rules of the build plan:
- a civitai entry without a pinned version id or a permission snapshot, or whose commercial / hostedOk
  flags disagree with its permissions (Image = outputs may be sold, Rent = may run on fal / Replicate);
- two entries with the same local file name but different downloads (ComfyUI keys LoRAs on the name);
- a file name that isn't a plain file name.

Run:  python3 scripts/gen-lora-library.py
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = json.loads((ROOT / "docs/research/fuobe-originals-recipes-5.json").read_text(encoding="utf-8"))
AS_OF = DATA["asOf"]
DOWNLOADS = {"direct", "civitai-token", "hf-gated"}
SAFE_FILE = re.compile(r"^[\w.\-\[\]() ]+\.safetensors$")
errors = []


def slug(s):
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", s.lower()))


def permissions(licence):
    """'civitai permissions: Image, RentCivit (no third-party hosting)' -> ['Image', 'RentCivit']."""
    m = re.match(r"^civitai permissions:\s*(.*)$", licence or "")
    if not m:
        return None
    return [p for p in (re.sub(r"\(.*?\)", "", x).strip() for x in m.group(1).split(",")) if p]


def entry(raw, key, group, checked=None, spare=False):
    where = f"{group} {key}"
    lic = raw.get("licence") or ""
    perms = permissions(lic)
    url = raw.get("url") or ""
    out = {
        "key": key,
        "name": raw["name"],
        "file": raw.get("file") or "",
        "url": url,
        "page": raw.get("page") or "",
        "strength": raw.get("strength", 1.0),
        "base": raw.get("base") or "",
        "download": raw.get("download") or "",
        "group": group,
    }
    trig = (raw.get("trigger") or "").strip()
    if trig:
        out["trigger"] = trig
    if raw.get("target"):
        out["target"] = raw["target"]
    elif out["base"].startswith("wan2.1"):
        # Wan 2.1 LoRAs run on both Wan 2.2 experts (build plan O1).
        out["target"] = "both"
    version = re.search(r"civitai\.com/api/download/models/(\d+)", url)
    if version:
        out["version"] = version.group(1)
    model = re.search(r"civitai\.com/models/(\d+)", out["page"])
    if model:
        out["civitaiModel"] = model.group(1)
    licence = {"commercial": bool(raw.get("commercial")), "hostedOk": bool(raw.get("hostedOk")), "snapshotDate": raw.get("checked") or checked or AS_OF, "name": lic}
    if perms is not None:
        licence["permissions"] = perms
    out["licence"] = licence
    for k in ("released", "hostedEndpoint", "notes"):
        if raw.get(k):
            out[k] = raw[k]
    if spare:
        out["spare"] = True

    # Licence rules (build plan → "Licence rules for Originals" → enforced by tests).
    if not SAFE_FILE.match(out["file"]) or "/" in out["file"] or ".." in out["file"]:
        errors.append(f"{where}: file {out['file']!r} is not a plain .safetensors name")
    if out["download"] not in DOWNLOADS:
        errors.append(f"{where}: unknown download {out['download']!r}")
    if not url.startswith("https://"):
        errors.append(f"{where}: no https download URL")
    if out["download"] == "civitai-token":
        if "version" not in out:
            errors.append(f"{where}: civitai download without a pinned version id ({url})")
        if not perms:
            errors.append(f"{where}: civitai download without a permission snapshot")
    if perms is not None:
        if licence["commercial"] != ("Image" in perms):
            errors.append(f"{where}: commercial={licence['commercial']} but permissions are {perms}")
        if licence["hostedOk"] != ("Rent" in perms):
            errors.append(f"{where}: hostedOk={licence['hostedOk']} but permissions are {perms}")
    return out


used = {l["key"] for p in DATA["presets"] for l in (p.get("loras") or [])}
used |= {l["key"] for l in DATA["soul"].get("loras") or [] if isinstance(l, dict) and l.get("key")}

library = []
by_file = {}


def add(e):
    prev = by_file.get(e["file"])
    if prev:
        if prev["url"] != e["url"]:
            errors.append(f"{e['key']}: file {e['file']} is also {prev['key']} with another download")
        return prev
    by_file[e["file"]] = e
    library.append(e)
    return e


for raw in DATA["loraLibrary"]:
    add(entry(raw, raw["key"], "look", spare=raw["key"] not in used))

motions = []
for m in DATA["motionsEffects"]:
    keys = []
    for raw in m.get("loras") or []:
        e = add(entry(raw, slug(re.sub(r"\.safetensors$", "", raw.get("file") or raw["name"])), m["kind"], checked=raw.get("checked")))
        if e["key"] not in keys:
            keys.append(e["key"])
    row = {"kind": m["kind"], "presets": m["presets"], "status": m["status"], "loras": keys,
           "bothEnginesToday": bool(m.get("bothEnginesToday")), "newSinceMid2026": bool(m.get("newSinceMid2026"))}
    hosted = (m.get("hosted") or {}).get("endpoint")
    if hosted:
        row["hostedEndpoint"] = hosted
    if m.get("notes"):
        row["notes"] = m["notes"]
    motions.append(row)

keys = [e["key"] for e in library]
dup = sorted({k for k in keys if keys.count(k) > 1})
if dup:
    errors.append(f"duplicate keys: {dup}")

if errors:
    print("gen-lora-library: the research breaks the licence rules:\n  " + "\n  ".join(errors), file=sys.stderr)
    sys.exit(1)

ts = (
    "// Generated by scripts/gen-lora-library.py from docs/research/fuobe-originals-recipes-5.json — do not edit by hand.\n"
    'import type { LoraEntry, MotionEffectLoras } from "./loras";\n\n'
    f"/** When the LoRA research (licences, civitai permissions, pinned versions) was read. */\n"
    f"export const LORA_LIBRARY_AS_OF = {json.dumps(AS_OF)};\n\n"
    "/** Every LoRA the Originals use: Soul looks (group \"look\") and motion / effect LoRAs, one entry per local file. */\n"
    f"export const LORA_LIBRARY: LoraEntry[] = {json.dumps(library, indent=2, ensure_ascii=False)};\n\n"
    "/** Motion and effect presets (Higgsfield's generic names) → their LoRA keys in LORA_LIBRARY, with the research's status. */\n"
    f"export const MOTION_EFFECT_LORAS: MotionEffectLoras[] = {json.dumps(motions, indent=2, ensure_ascii=False)};\n"
)
(ROOT / "src/lib/catalog/lora-library.generated.ts").write_text(ts, encoding="utf-8")
print(f"wrote {len(library)} LoRAs ({sum(1 for e in library if e['group'] == 'look')} looks) and {len(motions)} motion / effect rows")
