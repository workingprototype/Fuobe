# Handoff: continuing the build

Written on 2026-10-30, when PR #15 wrapped up the work so far, and revised the same day after the owner's decision on accounts (main wins). It is for whoever continues next: a new session or a person. Everything needed to pick up is in this file and in [`docs/handoff/`](handoff/).

## Start here

1. **Check that PR #15 is merged:** `git fetch origin && git log --oneline origin/main | grep -m1 'pull request #15'`.
   - While it is still open, use `origin/claude/fuobe-r5-batch-7` wherever this file says `origin/main`. That branch already holds main and this handoff.
   - First check that acc-1 and acc-2 are gone from it: `git grep -q better-auth origin/claude/fuobe-r5-batch-7 -- package.json` must find nothing.
2. **Set up the session** ("Setting up a new session" below). This includes rebuilding the base from main and moving the two branches with work in progress onto it.
3. **Ask the owner** the questions under "Waiting on the owner". Record the answers in [`handoff/owner-decisions.json`](handoff/owner-decisions.json), then commit them to `claude/fuobe-parity-4` and push.
4. **Build.**
   - If the owner asks for a workflow, follow "Running the build".
   - Otherwise build one package at a time through the same four stages, using the prompts the generated workflow script holds. Generate the script with `make-workflow.mjs` and read the prompts for that package.
5. **Before the session ends**, follow "Before a session ends". Branches, reports and journals that aren't pushed are lost with the container.

## Where things stand

- **`main`** (after PR #15) holds:
  - all of round 4, the Fuobe Originals O1 to O11 and O13, and from PR #14 Skills W1 and W2, Fixes 5 and the research notes for DBS, new models, Work2Skill and accounts
  - from PR #15: DBS soundtrack separation (D1), MOSS-Image (N7-1), the fly path (N7-5), the turnaround video (N7-6), the research for Idol (research 9) and this handoff. PR #15 does **not** carry acc-1 and acc-2: the owner dropped them (below). Its routes and tools follow the public sign-up rules (`tests/public-signup-tools.test.ts`), and its graphs are in the GPU pre-flight index, with board rows for Split soundtrack, Fly path and Turnaround.
  - the owner's own work from 10-30 (24 commits; read their messages with `git log dc51169..b5ca728`):
    - **public sign-up** (`docs/public-signup.md`), described under "Accounts" below.
    - **local LLMs:** `src/server/llm` and `/api/llm` cover Ollama, LM Studio, Unsloth Studio and any OpenAI-compatible server (Settings → AI helper).
    - **Pixal3D** is now the Image to 3D route for a photo, with the server's GLB finish and a CPU turntable (`scripts/comfy/hand-built/image-to-3d-pixal3d.json`). TRELLIS.2 is the fallback, and its graph was trimmed.
    - **premium preset covers:** 480 covers rendered on ComfyUI, in `public/previews/presets` (`pnpm eval:covers --from-masters`), and before/after reveal clips on 42 apps.
    - **the README is a product page.** The details moved to `docs/FEATURES.md`, `docs/SELF-HOSTING.md` and `docs/DEVELOPMENT.md`. Also new: the MIT licence, the tab icon and the demo video.
    - **the GPU pre-flight board at `/connect`.** It shows what the connected ComfyUI has, and every studio as Ready, One step away, Needs setup or Needs a bigger GPU. The same chips show on gallery cards, studio headers and the model picker. Its index is `workflows/comfyui/requirements.json`, which the library build writes.
    - **Your GPU, part 2** (`5e6a421`, `b5ca728`): accounts upload their own pictures, clips and sound, and run camera motions, effects and apps on their own ComfyUI. An account's work runs as a tenant (`src/server/tenant.ts`) that reads only its own files and runs. Migration 24 adds `assets.account_id`.
    - **the 3D finish** reads only the model it was given (`fd09201`).
- **Accounts** are the owner's public sign-up on main. It is off by default, and `FUOBE_PUBLIC_SIGNUP=1` turns it on. With it on:
  - guests browse read-only
  - anyone can sign up with an email; accounts live in `auth.json` with a scrypt hash
  - accounts see a guest view of the owner's library, can't touch settings, keys or tokens, and run only on their own ComfyUI (Settings → Your GPU, checked on `/connect`)
  - with its GPU connected, an account uploads its own files and runs the studios, camera motions, effects and apps there, on its own files only; other tools answer `own-gpu-tool`

  The PR #15 packages acc-1 (the Better Auth identity base) and acc-2 (the actor context on every route, with its integration fix 4e8359f) are dropped. The 55 remaining packages of the old accounts lane (acc-3 to acc-57) are dropped from the queue. The next accounts work starts with a new plan written with the owner, around public sign-up. [`research/accounts-8.md`](research/accounts-8.md) is background research only.
- **`claude/fuobe-parity-4`** is the integration branch. Packages are merged into it one at a time, and a PR is cut from it as a snapshot branch when the owner asks for one. It still points at `f7c6d8e`, which carries acc-1 and acc-2, so rebuild it from main before building (see "Setting up a new session").
- **38 packages are queued** in two lanes ([`handoff/queue.json`](handoff/queue.json)):
  - lane R: 17 packages, new models and DBS audio
  - lane O: 21 packages, the owner's calls, Originals, Idol, skills and the training kit
- **Two packages have work on pushed branches.** `o/acc-3` on origin is dropped work. See "Work in progress".

## The owner's rules (binding)

The owner's own words on engines, SAM Audio, accounts and the PR #14 calls are in [`handoff/owner-decisions.json`](handoff/owner-decisions.json). The first two rules below have been the product direction since round 4, and every build prompt carries them. Every brief in the queue already carries the rules that apply to it:

- **No Higgsfield API, keys or models.** Fuobe Originals rebuild Higgsfield's own products from open-weight models plus LoRAs. Higgsfield's client code is used only as facts about behaviour; its code, prompts and media are never copied.
- **Licences are information, not gates.** Build every model: paid, proprietary, open, closed and non-commercial. Record each licence as data. The admin turns models on or off in Settings → Models & licences.
- **Each engine does all it can** (the owner, 10-30): "whatever is possible in cloud only in cloud, whatever possible in local can work on local… If we can do lora only in local, then we do that on local, not remove it from both."
  - The cloud only uses models that are hosted, with no substitute model, and only what the hosted endpoint supports.
  - The open engine keeps every capability it has: LoRAs, custom nodes, longer clips and references.
  - Say plainly in the UI what each engine does.
- **No SAM Audio stand-in in the cloud** (`samAudioCloud: false`, the owner's choice). DBS isn't hosted, so:
  - the DBS packages split soundtracks on the open engine only
  - today's cloud dub (Demucs) stays as it is
  - hosted speech cleaners (VEED, DeepFilterNet, ElevenLabs isolation) are used only under their own names
- **Accounts are the owner's public sign-up** (the owner, 10-30: "main wins"; key `accounts_10_30`). Every route, page and run a package adds follows it the way main's own routes do. Every brief ends with a PUBLIC SIGN-UP rule:
  - read [`public-signup.md`](public-signup.md), `src/lib/guest-access.ts`, `src/proxy.ts` and `tests/public-signup.test.ts`
  - price checks (estimate routes, `?preview=1` on run routes) go in `ESTIMATES` or `PREVIEWS` and run through `priceAs` (`src/server/visitor.ts`), so a visitor is priced as its own run would go: on its own GPU, with only its own files, never a demo
  - changes to the owner's library or projects go in `LIBRARY_CHANGES` (403 `code: "library"` for an account); settings, keys and tokens stay the owner's
  - only the owner's runs reach the install's keys or GPU. An account's runs through `POST /api/generations` go to its own ComfyUI inside `runAsTenant` (`src/server/tenant.ts`), with only its own uploads and results; other runs answer `connect-gpu`, then `own-gpu-tool`
  - the owner's lists come back empty for a visitor, and a visitor is never told whether one of the owner's records exists
  - new ComfyUI graphs and node packs go into the GPU pre-flight index (`workflows/comfyui/packs.json`, `model-pins.json`, then `node scripts/comfy/build-requirements.mjs`), and new studios and tools get a row on the `/connect` board (`src/server/gpu/tools.ts` `STUDIO_ROWS`)
  - test them in the style of `tests/public-signup.test.ts` and `tests/public-signup-tools.test.ts`

  The owner's earlier accounts answers of 10-29 (three modes, teams, plans, an admin panel, paid keys both ways, enterprise features) stay under the key `accounts`. They are background for the re-plan, to be confirmed with the owner.
- **The owner's calls from PR #14** are package `owner-calls-1`, first in lane O:
  - Evolution's cloud route moves onto fal's hosted Wan 2.2 Fun VACE.
  - "Fuobe Speak" keeps its name. The GPU runs FusioniX and the cloud runs without it, and the UI says so.
  - Fuobe DoP stays the default for DoP's 32 Mixed Media effects. The first evaluation run with paid keys does a blind A/B against Kling 2.5 Turbo. The default goes back only if Fuobe DoP clearly loses.

## Waiting on the owner

- **Re-plan accounts around public sign-up.** The seven open questions of accounts-8.md §15 are moot. Ask the owner what accounts should become beyond public sign-up, for example:
  - teams, and sharing inside a team
  - accounts with their own uploads, projects and library
  - plans, credits and payments, and an admin panel beyond Settings → Accounts
  - which of the 10-29 answers still stand: the three modes (Personal, In-house studio, Platform) and enterprise features (SSO, SCIM, audit)

  Record the answers in `owner-decisions.json`, write a new plan as a research note, then queue packages from it. Don't restart from the old acc-* lane.
- **Two workflow files the owner shared.** The owner needs to share them again. They were read in the container of the session that wrote this file (PR #15) and not committed, because their origin and licence are unknown.
  - `inbetweening/Animation5-In-Betweening.json`, Comfy's "Animation: Keyframes to Full Character Animation", for package `inbetweening`
  - `blockout/Horror_Scene_SD2.5.json`, Comfy's "Horror scene", for package `blockout-film`

  Put them in the inputs folder (below). Both briefs describe what was learned from them, so the packages can start without them.
- **`o/acc-3` on origin** is dropped work. Ask the owner whether to delete it (`git push origin --delete o/acc-3`).

## What's left: the queue

Lanes run side by side. Inside a lane, packages run in this order, and each package starts from the integration branch with everything before it merged. Each package goes through four steps:

1. **Implement** in its own worktree, on branch `o/<key>`.
2. **Adversarial review.** The reviewer verifies each finding but doesn't edit.
3. **Fix** the confirmed findings, then run typecheck, lint and the full Vitest run.
4. **Merge.** One integrator at a time merges the package into `claude/fuobe-parity-4`, runs typecheck, lint and Vitest, and pushes.

**Lane R:**
- `n7-2-layout-mode`: Layout mode in the Image studio. Implement and review are done; the fix stage is next, after the branch is moved onto the rebuilt base.
- DBS packages: `dbs-d2` (remove dialogue), `dbs-d3` (dub keeps the music)
- New models: `n7-3-regenerate-2k`, `n7-4-character-swap-2k`, `qma-angles`, `inbetweening`, `person-remover-plus`
- More DBS: `dbs-d5` (clean up dialogue), `dbs-d6` (clean voice before transcribe and lipsync), `dbs-d7` (an "Original sound" choice), `dbs-d8` (a Canvas node), `dbs-d9` (Assist and MCP tools)
- `n7-8-layouts-everywhere`
- `dbs-d4`: the separation evaluation
- `n7-10-regenerate-more`, `n7-11-moss-sheets-control`

**Lane O:**
- `owner-calls-1`
- `archive-restore`: LTX Restore. Work in progress.
- `blockout-film`
- Skills: `w2s-w3`, `w2s-w4`
- New models: `n7-7-exact-orbits`, `n7-9-worldcast-worker`, `hi3d-refine`
- Idol: `idol-1`, `idol-2`, `idol-4`, `idol-5`, `idol-3`, `idol-6`, `idol-7`, `idol-8`, `idol-9`
- `o12-training-kit`
- More skills: `w2s-w5`, `w2s-w6`, `w2s-w7`

Each package's full brief is in `queue.json` under `packages.<key>.brief`, with its research sections, the owner's rules and its test plan. Every brief ends with the PUBLIC SIGN-UP rule. Briefs in areas main changed on 10-30 carry a "MAIN CHANGED THIS AREA" line to read main's code first: Image to 3D, local LLMs, and the pre-flight board for new studios. `n7-3-regenerate-2k` and `archive-restore` both add a step to Upscale → Video at the same time, and each brief says how to keep them apart.

## Work in progress

Both branches with work are pushed to `origin`, cut from the old `claude/fuobe-parity-4` head `f7c6d8e`. That head carries the dropped acc-1 and acc-2, so the main session moves each branch onto the rebuilt base before any stage runs (see "Setting up a new session"). Each package's full notes are in `queue.json` under `wip`: what is built, the next steps and the risks. `make-workflow.mjs` passes them to the package's agents.

| Branch | State | What the next run does |
|---|---|---|
| `o/n7-2-layout-mode` | 5 commits, head `492643b`. Implement and review are done; both reports are in `queue.json` under `done`. Nothing was committed after the review, so its 10 findings still apply. | The fix stage. Two majors: cloud layout runs lose fal's seed (`extractOutputs` in `payload.ts` keeps it only with an `actual_prompt`), and a second Edit layout on the same picture does nothing (`LayoutHandoff` never resets `opened.current`). Also a weak e2e check, and minors on keyboard resize, contrast and an admin-disabled model. |
| `o/archive-restore` | 6 commits, head `b84bc01`, from an implement stage that stopped before it reported (64 files). Built: both engines, the tiled-fusion graph (not validated: the CPU server lacks ComfyUI-LTXVideo), `/api/restore`, Video tools, Canvas, Shorts, the Explainer, Assist/MCP and tests. Missing: Faceless, and Upscale's "Restore archive footage first". | Implement again, resuming from the branch: <ul><li>rewrite its three routes without acc-2's `handler()` and to the public sign-up rules</li><li>fix the flaky `restore-api` test (`ORDER BY rowid`)</li><li>limit the gated-LoRA change: without a Hugging Face token, cloud runs with the gated Relight or Slow-Motion LoRAs now fail</li><li>finish the placements, then run the e2e and browser checks</li><li>then review and fix</li></ul> |
| `o/acc-3` | 1 WIP commit, head `3106848`, for the dropped accounts lane. | Nothing: dropped work. The owner may delete it. |

When both packages merge, they conflict in one place: the lucide import list in `src/components/studio/result-actions.tsx`. Keep both `LayoutDashboard` and `Palette`.

## Setting up a new session

The container starts fresh, so set up the following before building.

**1. The repository and the base.** The base must match main. Main never got acc-1 and acc-2 (the owner dropped them), but `claude/fuobe-parity-4` still carries them:

```bash
cd /home/user/Fuobe                      # the repository
git fetch origin
MAIN=origin/main                         # while PR #15 is still open: MAIN=origin/claude/fuobe-r5-batch-7
git checkout claude/fuobe-parity-4
git log --oneline --no-merges $MAIN..origin/claude/fuobe-parity-4   # what the base has that main lacks
```

Act on what the last command prints:
- **Nothing:** `git merge --ff-only $MAIN && git push origin claude/fuobe-parity-4`.
- **Only the dropped accounts work:** the "Accounts 1…" and "Accounts 2…" commits, plus 4e8359f "Turnaround routes go through handler()". Run `git reset --hard $MAIN && git push --force-with-lease origin claude/fuobe-parity-4`. This applies the owner's 10-30 decision; the old head was `f7c6d8e`.
- **Anything else:** stop. Compare with `git diff --stat $MAIN origin/claude/fuobe-parity-4` and ask the owner.

**2. The two branches with work in progress.** If you reset the base, move each branch's own commits onto it. Expect conflicts with main's 10-30 work in `src/server/generations.ts` and `src/server/settings.ts` (the 3D finish, local LLMs and public sign-up changed them):

```bash
git checkout -B o/n7-2-layout-mode origin/o/n7-2-layout-mode
git rebase --onto claude/fuobe-parity-4 f7c6d8e      # only the package's own commits move; on a conflict: fix, git add, git rebase --continue
git push --force-with-lease origin o/n7-2-layout-mode
# the same three commands for o/archive-restore, then:
git checkout claude/fuobe-parity-4
```

If the base was fast-forwarded instead, leave the branches as they are: each package's agent merges the base in. `make-workflow.mjs` refuses to write a script while a queued `o/<key>` branch still carries another package's merges, and names the branches.

**3. Tools and ComfyUI:**

```bash
pnpm install --frozen-lockfile && npx next typegen   # typegen before every typecheck in a fresh checkout
(cd scripts/comfy && npm install)                    # playwright-core: the ComfyUI pipeline and tests/comfy-dbs.test.ts
bash scripts/comfy/install-comfyui.sh                # CPU ComfyUI 0.41 + the pinned node packs, outside the repo; several minutes: run it in the background and wait
bash scripts/comfy/start-comfyui.sh                  # http://127.0.0.1:8188; waits up to 5 minutes; start it again after every container restart
mkdir -p /home/user/ext                              # the inputs folder below
```

**Inputs folder.** Some briefs read files kept outside the repo, in a folder the briefs call `@EXT@` (default `/home/user/ext`). Read them as data: never run or install them. Fetch them before their package starts (commands below):

| Path under `@EXT@` | Package | Source |
|---|---|---|
| `person-remover/` (README, LICENSE, examples) | `person-remover-plus` | https://huggingface.co/akatz-ai/MiniMax-H3-Person-Remover-LoRA |
| `ltx-restore/README.md` | `archive-restore` | https://huggingface.co/Lightricks/LTX-2.5-22b-IC-LoRA-Restore (the model card is public; the weights are gated and need a Hugging Face token) |
| `hi3d/README.md`, `hi3d/LICENSE` | `hi3d-refine`, `idol-7` | https://github.com/hi3d-official/Hi3Dv1.0 (the code repo's README, whose line numbers idol-7 cites; the weights are https://huggingface.co/hi3d-official/Hi3Dv1.0) |
| `moss-image/repo` (`skills/moss-image-prompt-enhancer/`) | `n7-8-layouts-everywhere` | https://github.com/OpenMOSS/MOSS-Image at `2b46b1e0` |
| `inbetweening/Animation5-In-Betweening.json` | `inbetweening` | the owner (see "Waiting on the owner") |
| `blockout/Horror_Scene_SD2.5.json` | `blockout-film` | the owner |

```bash
EXT=/home/user/ext && mkdir -p $EXT/person-remover $EXT/ltx-restore $EXT/hi3d
for f in README.md LICENSE examples/README.md examples/H3-Person-Removal-Relay-V2.api.json examples/Person-Remover-Window-Reroll-V1.json; do
  curl -fsSL "https://huggingface.co/akatz-ai/MiniMax-H3-Person-Remover-LoRA/resolve/main/$f" -o "$EXT/person-remover/${f//\//_}"
done
curl -fsSL https://huggingface.co/Lightricks/LTX-2.5-22b-IC-LoRA-Restore/resolve/main/README.md -o $EXT/ltx-restore/README.md
for f in README.md LICENSE; do curl -fsSL "https://raw.githubusercontent.com/hi3d-official/Hi3Dv1.0/main/$f" -o "$EXT/hi3d/$f"; done
git clone -q https://github.com/OpenMOSS/MOSS-Image $EXT/moss-image/repo && git -C $EXT/moss-image/repo checkout -q 2b46b1e0e13b5aaec253879e0d006a42564b8b27
```

Research notes cite `/home/user/ext/<name>` for the clones they read. Each note gives the repository and the commit, so clone again into `@EXT@/<name>` if a package needs one. `/home/user/ext/owner-decisions.json` is now [`handoff/owner-decisions.json`](handoff/owner-decisions.json).

## Running the build

The build runs as a workflow: several agents run with the Workflow tool. A new session runs one only after the owner says so there (for example "use a workflow"). [`handoff/make-workflow.mjs`](handoff/make-workflow.mjs) writes the workflow script from the queue and [`handoff/workflow.body.js`](handoff/workflow.body.js):

```bash
printf '%s\n' '<your session commit attribution line 1>' '<line 2>' > /tmp/trailer.txt   # one argument per line
node docs/handoff/make-workflow.mjs /tmp/fuobe-build.js --trailer-file /tmp/trailer.txt
# then: Workflow({ scriptPath: "/tmp/fuobe-build.js" })
```

- **Options:**
  - `--skip key,key` leaves out the packages you name. Packages already merged into the base, found by their "Merge branch 'o/<key>'" commits, drop out by themselves.
  - `--only R` or `--only O` runs one lane.
  - `--done results.json` brings in stages finished since the queue was written: `{ "<key>": { "impl"?: report, "review"?: report, "fix"?: report } }`, the reports as the agents returned them.
  - `--journal <journal.jsonl>` (repeatable, oldest first) reuses the stages a stopped run finished and leaves out what its integrator merged. A run's journal is in its transcript folder (`~/.claude/projects/<project>/<session>/subagents/workflows/wf_*/journal.jsonl`), so it only exists in the container that ran it.
  - Finished stages merge stage by stage: the queue's `done`, then the journals, then `--done`. A newer report of an earlier stage drops the older later stages.
  - `--save-done` also writes those stages into `queue.json` `done` (see "Before a session ends").
  - `--remove-worktrees` lets the integrator delete merged worktrees. Pass it only if the owner agrees.
- **Size limit.** Scripts must stay under 512 KB. Both lanes come to about 335 KB.
- **Usage limits and restarts.** A lane stops at the first package that fails a stage, so a relaunch picks up there. A stage can also stop as "blocked", for example on a branch cut from a rebuilt base; the log says why.
  - In the same session, resume with `resumeFromRunId`: finished agent calls are reused.
  - In a new session, regenerate the script. Merged packages drop out by themselves, and the finished stages come from `queue.json` `done`. Agents resume from what their pushed branch already holds.
- **One integrator at a time.** Only the integrator touches the main checkout. Every other agent works in `../wt/o-<key>`.
- **Worktrees take room** (about 1 GB with `node_modules` and `.next`). The disk allowance is fixed per session, so watch `df` and ask the owner before deleting anything.

## Before a session ends

Workflow journals, reports, worktrees and the inputs folder don't survive a new container. Only what is pushed does.

1. **Push every `o/<key>` branch** that has commits not in `claude/fuobe-parity-4`: `git push -u origin o/<key>`. WIP commits are fine; say so in the commit message.
2. **Save the finished stages** of packages that aren't merged:

   ```bash
   node docs/handoff/make-workflow.mjs /tmp/x.js --trailer-file /tmp/trailer.txt --journal <journal.jsonl> --save-done
   ```

   This writes them into `queue.json` `done`. Then update `wip` in `queue.json` and the "Work in progress" table here.
3. **Commit that to `claude/fuobe-parity-4`** in the main checkout, while no integrator is running, and push.

## Cutting a PR

Only cut a PR when the owner asks for one. The steps that worked for PRs #12 to #15:

1. **Snapshot branch.** Branch `claude/fuobe-r5-batch-<n>` from `claude/fuobe-parity-4`, merge `origin/main` into it, and resolve docs conflicts by keeping both sides.
2. **Verify:** `bash docs/handoff/verify.sh claude/fuobe-r5-batch-<n> /tmp/verify-<n>` (needs ComfyUI running). It works from any folder: its throwaway worktree goes next to the main checkout. It runs:
   - typecheck, lint, Vitest, the evaluation cases and the production build
   - every browser check in demo mode
   - hosted prices with a fake fal key
   - the live CPU ComfyUI checks and the workflow library

   It lists any `tests/e2e` script it doesn't run yet. `comfy-validate` exits 1 by design on this server: its log should list only the graphs named under "Known gaps". Before fixing a failing check, reproduce it, then show it passing three times on fresh data.
3. **Describe** with [`handoff/pr-describe.js`](handoff/pr-describe.js), a Workflow script: area readers, then a writer, three fact-check lenses (accuracy, completeness, clarity) and a reviser. The session-specific values are its `args`, listed at the top of the file:

   ```js
   Workflow({ scriptPath: "docs/handoff/pr-describe.js", args: {
     repo: "/home/user/Fuobe", head: "claude/fuobe-r5-batch-<n>", base: "<main's commit the PR builds on>", pr: <n>,
     round: "Round 5, part 3", reports: "/tmp/pr-<n>/reports", out: "/tmp/pr-<n>",
     history: "<how the branch was made>", areas: [{ key, title, pkgs: [["<package>", "<merge commit>"]] }],
     notInPr: "<the queue's next packages>", handoff: "<what changed in the handoff>" } })
   ```

   - `reports` holds `<package>.json` per merged package: each entry the build workflow returned, `{ key, impl, review, fix, merge }`.
   - It saves the title and body in `out`. Fill the body's `<!-- CHECKS -->` line from verify.sh's summary.
4. **Docs pass** with [`handoff/pr-docs.js`](handoff/pr-docs.js): writers per doc group, then accuracy and staleness checkers and a reviser. Its args are `worktree`, `docsBase`, `pr`, `round`, `summary`, `notYet` and `facts` (the folder with `body.md` and `reports/`).
   - Since the owner's 10-30 work, the docs live in [`README.md`](../README.md) (the product page, with "Upgrading from an earlier version"), `docs/FEATURES.md`, `docs/SELF-HOSTING.md`, `docs/DEVELOPMENT.md`, [`docs/STATUS.md`](STATUS.md) and [`docs/ARCHITECTURE.md`](ARCHITECTURE.md), plus `docs/public-signup.md`, [`docs/research/README.md`](research/README.md) and [`scripts/comfy/README.md`](../scripts/comfy/README.md) (library counts).
   - Review the diff it leaves, then commit it to the snapshot branch.
5. **Open the PR** against `main`, with the checks summary and what none of the checks cover (no GPU, no paid keys).

## Known gaps and gotchas

- **Next.js 16:** run `npx next typegen` before `pnpm typecheck` in a checkout without `.next`, and read `node_modules/next/dist/docs/` before writing Next-specific code.
- **Stopping servers:** the server process is named `next-server`, so `pkill -f "next start"` misses it. Stop servers by port with `fuser -k -n tcp <port>`. Ports 3399 to 3401 belong to verify.sh, and 8188 to ComfyUI.
- **Turbopack warnings:** dynamic `fs` paths need `/*turbopackIgnore: true*/`, or Turbopack traces the whole project.
- **ComfyUI on this kind of server:** it accepts all but a few library workflows. The rest need node packs it lacks:
  - `sfx-thinksound` and `lipsync-latentsync16`, which belong on the isolated worker (`install-isolated-worker.sh`)
  - the four H3 Relay graphs: `video-character-swap-h3-relay`, `video-person-remove-h3-relay`, `video-character-swap-h3-segment` and `video-mask-h3-relay` (install with `H3_RELAY=1`)
  - on a server installed before today's script: `captions-whisper-burnin`, `image-vectorize-vtracer`, `video-character-swap-h3` (h3_character_swap) and `separate-soundtrack-dbs` (ComfyUI-DBS)

  Never install packs or restart ComfyUI from a package agent. Say what's needed instead.
- **The pre-flight index:** PR #15 put its graphs into `workflows/comfyui/requirements.json` (158 workflows, with ComfyUI-DBS in `packs.json`) and gave Split soundtrack, Fly path and Turnaround rows in `STUDIO_ROWS` (`src/server/gpu/tools.ts`). A package that adds a graph or a studio does the same; `node scripts/comfy/build-requirements.mjs` rewrites the index.
- **Data folders that ran the old integration branch:** migrations are known by their place in `MIGRATIONS`, and on `claude/fuobe-parity-4` up to `f7c6d8e` places 23 and 24 were acc-1's identity tables and acc-2's audit-log trigger. On main they are the GPU pre-flight's tables and `assets.account_id`. `open()` in `src/server/db.ts` forgets either place when main's work is missing and the dropped package's is there, so main's migration runs (`tests/dropped-branch-migrations.test.ts`). The dropped tables stay, unused. Never reuse a place in that list: only append.
- **Public sign-up** is off by default, and verify.sh's servers run without it. `tests/public-signup.test.ts`, `tests/public-signup-tools.test.ts` and `tests/account-*.test.ts` pin the guest and account answers. Accounts are refused for space while the data disk has less than 20 GB free (`FUOBE_ACCOUNT_DISK_FREE_GB`), so on a small disk run Vitest with `FUOBE_ACCOUNT_DISK_FREE_GB=1`, or `tests/gpu-api.test.ts` answers 503 where it expects 409.
- **What none of the checks cover:** no GPU and no paid key have been used. Every Original is checked in demo mode, on the CPU ComfyUI (graphs accepted, no weights run) and by unit tests, but not for image quality or real bills.
- **The owner's workflow JSONs and downloaded repos:** never commit them, never run them.
