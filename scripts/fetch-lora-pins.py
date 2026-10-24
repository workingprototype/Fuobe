#!/usr/bin/env python3
"""
Research helper (needs the network; not part of gen:catalog): pin every LoRA of
docs/research/fuobe-originals-recipes-5.json (loraLibrary and motionsEffects[].loras) to exact bytes, so
Fuobe's downloader (src/server/loras.ts) checks each file against a hash read once and committed, not
against whatever the source serves that day.

- Hugging Face (`resolve/main/...`): the commit `main` is at today (`revision`) and the file's LFS SHA256
  and size at that commit, from /api/models/<repo>/revision/main?blobs=true (public metadata, gated repos
  included). scripts/gen-lora-library.py turns the URL into `resolve/<revision>/...`.
- civitai (`/api/download/models/<version>`): the pinned version's primary file SHA256 and size, from
  /api/v1/model-versions/<version>, after checking the version belongs to the model the entry's page names.

Adds `sha256`, `sizeBytes`, `revision` (Hugging Face) and `pinned` (the date) to each entry; existing pins
are kept unless --refresh is given. Exits 1 when a file can't be found or a version belongs to another model.

Run:  python3 scripts/fetch-lora-pins.py [--refresh]
"""
import datetime
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILE = ROOT / "docs/research/fuobe-originals-recipes-5.json"
TODAY = datetime.date.today().isoformat()
HF = re.compile(r"^https://huggingface\.co/([^/]+/[^/]+)/resolve/main/(.+)$")
CIVITAI = re.compile(r"^https://civitai\.com/api/download/models/(\d+)")


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "fuobe-research/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


_repos = {}


def hf_pin(repo, path):
    if repo not in _repos:
        _repos[repo] = get(f"https://huggingface.co/api/models/{repo}/revision/main?blobs=true")
    info = _repos[repo]
    sib = next((s for s in info.get("siblings") or [] if s.get("rfilename") == path), None)
    if not sib or not (sib.get("lfs") or {}).get("sha256"):
        raise SystemExit(f"{repo}: {path} is not an LFS file at main")
    return {"revision": info["sha"], "sha256": sib["lfs"]["sha256"].lower(), "sizeBytes": sib["lfs"]["size"]}


def civitai_pin(version, page):
    v = get(f"https://civitai.com/api/v1/model-versions/{version}")
    model = re.search(r"civitai\.com/models/(\d+)", page or "")
    if model and str(v.get("modelId")) != model.group(1):
        raise SystemExit(f"civitai version {version} belongs to model {v.get('modelId')}, not {model.group(1)}")
    files = v.get("files") or []
    f = next((x for x in files if x.get("primary")), None) or next((x for x in files if (x.get("name") or "").endswith(".safetensors")), None)
    sha = ((f or {}).get("hashes") or {}).get("SHA256")
    if not sha:
        raise SystemExit(f"civitai version {version}: no SHA256 for its file")
    return {"sha256": sha.lower(), "sizeBytes": round(f["sizeKB"] * 1024)}


def main():
    refresh = "--refresh" in sys.argv
    data = json.loads(FILE.read_text(encoding="utf-8"))
    entries = list(data["loraLibrary"]) + [l for m in data["motionsEffects"] for l in (m.get("loras") or [])]
    done = {}
    for e in entries:
        if e.get("sha256") and not refresh:
            continue
        url = e.get("url") or ""
        if url not in done:
            hf, cv = HF.match(url), CIVITAI.match(url)
            if hf:
                done[url] = hf_pin(hf.group(1), urllib.parse.unquote(hf.group(2)))
            elif cv:
                done[url] = civitai_pin(cv.group(1), e.get("page"))
            else:
                raise SystemExit(f"{e.get('key') or e.get('name')}: can't pin {url}")
            print(f"{e.get('file')}: {done[url]['sha256'][:12]}… {done[url].get('revision', '')[:12]}")
        e.update(done[url])
        e["pinned"] = TODAY
    FILE.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
