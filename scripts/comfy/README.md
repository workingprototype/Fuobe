# scripts/comfy — Fuobe ComfyUI workflow pipeline

Produces the API-format workflow library in `workflows/comfyui/` (one `<id>.json` per workflow,
`manifest.json`, `object_info.subset.json`) from official ComfyUI templates, custom-node example
workflows and a few hand-built graphs, and validates every workflow against a real ComfyUI server.
No GPU and no model weights are needed (validation uses zero-byte placeholder model files).

Full write-up (what is in the library, validation results, models, quirks for app code):
[`docs/research/comfyui-workflow-library.md`](../../docs/research/comfyui-workflow-library.md).

## Files

| file | purpose |
|---|---|
| `install-comfyui.sh` | reproducible CPU install of ComfyUI + the 8 custom node packs (pinned commits) |
| `start-comfyui.sh` / `stop-comfyui.sh` | run ComfyUI in the background on 127.0.0.1:8188 (log: `$COMFYUI_DIR/logs/comfyui.log`) |
| `export-templates.mjs` | Playwright: opens the ComfyUI frontend, `app.loadGraphData(ui)` → `app.graphToPrompt().output`, writes `build/raw/<key>.api.json` + `.meta.json` (embedded model URLs, missing node types) |
| `library.spec.mjs` | the curated list: id, title, capability, source, transforms, bindings, outputs, limits, VRAM, notes |
| `lib/graph.mjs` | API-graph transforms (resolve constant switches, set/delete inputs, insert nodes, prune, lint) |
| `hand-built/*.json` | API-format graphs written by hand from `/object_info` definitions |
| `build-library.mjs` | spec + raw exports → `workflows/comfyui/<id>.json` + `manifest.json` (models, sizes via Hugging Face, custom-node packs, defaults) |
| `validate-workflows.mjs` | POSTs every workflow (bindings filled with sample values) to `/prompt`, requires HTTP 200 + `prompt_id` + no `node_errors`, then deletes it from the queue before it can run (a KJNodes `Sleep` "blocker" prompt keeps the worker busy meanwhile; final `POST /queue {"clear":true}` + `POST /interrupt`); updates `manifest.json`, `validation-state.json`, writes `object_info.subset.json` |
| `fixtures/` | tiny png / mask / wav / mp4 uploaded during validation |
| `validation-state.json` | sha256 of each validated workflow file → lets `build` keep `validated: true` when a file is unchanged |

## Exact commands used (2026-10-16, Linux, Python 3.13, Node 22, CPU only)

```bash
# 1. ComfyUI (outside the repo)
git clone https://github.com/comfyanonymous/ComfyUI /home/user/ComfyUI        # HEAD fc04da91 = v0.41.0-7
cd /home/user/ComfyUI
uv venv --python 3.13 .venv
uv pip install --python .venv/bin/python torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
uv pip install --python .venv/bin/python -r requirements.txt   # comfyui-frontend-package 1.55.17, comfyui-workflow-templates 0.11.86

# 2. custom node packs (git clone --depth 1 into custom_nodes/) + their deps — see install-comfyui.sh
#    (the script does all of 1+2 with pinned commits:  bash scripts/comfy/install-comfyui.sh)

# 3. start (background) — equivalent to: cd /home/user/ComfyUI && .venv/bin/python main.py --cpu --listen 127.0.0.1 --port 8188
bash scripts/comfy/start-comfyui.sh
curl -s http://127.0.0.1:8188/object_info | head -c 100

# 4. pipeline
cd scripts/comfy
npm install                      # playwright-core only; uses the preinstalled Chromium in /opt/pw-browsers
npm run export                   # all template/example sources referenced by library.spec.mjs
npm run build                    # needs outbound HTTPS to huggingface.co for model sizes (NODE_USE_ENV_PROXY=1 is set in the script)
npm run validate                 # needs ComfyUI running; never runs a model
# or: npm run all
```

Single items: `node export-templates.mjs video_wan2_2_14B_i2v`, `npm run build -- wan22-i2v-14b`,
`node validate-workflows.mjs wan22-i2v-14b`. `--shared` skips the final global queue clear/interrupt.
`node validate-workflows.mjs --keep-dummies` keeps the
zero-byte model placeholders (by default they are deleted after the run; real model files are never touched,
so the validator is safe to point at a real GPU server via `COMFYUI_URL` + `COMFYUI_DIR`/`COMFYUI_MODELS_DIR`).

Environment variables: `COMFYUI_URL` (default `http://127.0.0.1:8188`), `COMFYUI_DIR` (default `/home/user/ComfyUI`),
`COMFYUI_MODELS_DIR`, `CHROMIUM_PATH` (default: newest `/opt/pw-browsers/chromium-*/chrome-linux/chrome`).

## Adding a workflow

1. Find the template name in `$COMFYUI_DIR/.venv/lib/python3.*/site-packages/comfyui_workflow_templates_json/templates/index.json`
   (or a custom-node `example_workflows/*.json`), run `node export-templates.mjs <name-or-path>`.
2. Inspect `build/raw/<key>.api.json` (node ids like `129:98` = subgraph instance 129, inner node 98).
3. Add an entry to `library.spec.mjs` (bindings must target literal widget inputs, not links — the build fails otherwise).
4. `npm run build -- <id> && node validate-workflows.mjs <id>`.

## Known environment issues

- `ComfyUI-SeedVR2_VideoUpscaler` (numz) does not register on CPU-only hosts: its loaders build the device
  combo from CUDA/MPS devices and crash with `list index out of range`. The library uses the **native**
  SeedVR2 nodes of core ComfyUI instead (official templates `utility_seedvr2_*`).
- `ComfyUI-RMBG` imports its SAM3 module eagerly; without `triton`, `decord` and `pycocotools` the whole
  pack fails to load (its error handler itself raises `NameError: module_name`). They are installed by `install-comfyui.sh`.
- `ComfyUI-Frame-Interpolation`: cupy is not installed (CPU); RIFE works without it.
- `ComfyUI-ReActor` downloads ~1 GB of face-restore weights into `models/facerestore_models` whenever that
  folder is empty, even on `GET /object_info`; `install-comfyui.sh` drops a zero-byte placeholder there (skip with `REAL_MODELS=1`).
  It also logs a harmless `KeyError: 'ultralytics_bbox'` for its unused `ReActorMaskHelper` node on `/object_info`.
- Some nodes download weights the moment they *execute* (ComfyUI-RMBG, RIFE VFI, WanVideoWrapper wav2vec, ReActor
  detectors). The validator therefore never lets a validation prompt reach the worker (see the blocker above). An
  earlier naive version (POST, then interrupt) let ComfyUI-RMBG start fetching BEN2; that file was deleted.
- Node's built-in `fetch` ignores `HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1` (set in `npm run build`).
