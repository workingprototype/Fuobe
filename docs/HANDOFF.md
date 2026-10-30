# Handoff: continuing the build

Written on 2026-10-30, when PR #15 wrapped up the work so far, for whoever continues next: a new session or a person. Everything needed to pick up is in this file and in [`docs/handoff/`](handoff/).

## Where things stand

- **`main`** (after PR #15) holds:
  - all of round 4 and the Fuobe Originals O1 to O11 and O13
  - DBS soundtrack separation (D1)
  - MOSS-Image (N7-1), the fly path (N7-5) and the turnaround video (N7-6)
  - the research for Idol (research 9)
  - the owner's public sign-up, Settings → Accounts and Your GPU with the GPU pre-flight
    ([`public-signup.md`](public-signup.md)), which PR #15's tools follow (`tests/public-signup-tools.test.ts`)
- **Accounts: main's public sign-up stands** (the owner's decision, 10-30). The accounts packages acc-1 (the Better Auth
  identity base) and acc-2 (the actor context on every route) were reverted out of PR #15, and the accounts lane (acc-3 to
  acc-57) left the queue. Accounts will be planned again from scratch around public sign-up by a later session;
  [`research/accounts-8.md`](research/accounts-8.md) stays as background research only.
- **`claude/fuobe-parity-4`** is the integration branch. Packages are merged into it one at a time. A PR is cut from it as a snapshot branch when the owner asks for one. After PR #15 merges, bring `main` into it first (`git merge origin/main`). The branch still has acc-1 and acc-2 merged; that merge brings in PR #15's reverts of both and the owner's public sign-up.
- **38 packages are queued** in two lanes ([`handoff/queue.json`](handoff/queue.json)):
  - lane R: 17 packages, new models and DBS audio
  - lane O: 21 packages, the owner's calls, Originals, Idol, skills and the training kit
- **Two packages have work on pushed branches.** See "Work in progress" below.

## The owner's rules (binding)

The owner's own words are in [`handoff/owner-decisions.json`](handoff/owner-decisions.json). Every brief in the queue already carries the rules that apply to it:

- **No Higgsfield API, keys or models.** Fuobe Originals rebuild Higgsfield's own products from open-weight models plus LoRAs. Higgsfield's client code is used only as facts about behaviour; its code, prompts and media are never copied.
- **Licences are information, not gates.** Build every model: paid, proprietary, open, closed and non-commercial. Record each licence as data. The admin turns models on or off in Settings → Models & licences.
- **Each engine does all it can** (the owner, 10-30): "whatever is possible in cloud only in cloud, whatever possible in local can work on local… If we can do lora only in local, then we do that on local, not remove it from both."
  - The cloud only uses models that are hosted, with no substitute model, and only what the hosted endpoint supports.
  - The open engine keeps every capability it has: LoRAs, custom nodes, longer clips and references.
  - Say plainly in the UI what each engine does.
- **Public sign-up rules every package** (the owner's, on main; 10-30: main wins over the accounts lane). Read
  [`public-signup.md`](public-signup.md), `src/lib/guest-access.ts` and `src/proxy.ts`. A new route or tool gets what main
  gives the same kind of route:
  - Price checks (estimate routes, `?preview=1` on run routes) go in `ESTIMATES` or `PREVIEWS` and run through `priceAs`
    (`src/server/visitor.ts`), so guests and accounts are priced for their own GPU, never a demo.
  - Changes to the library or projects go in `LIBRARY_CHANGES` (403 `code: "library"` for an account). Settings, keys
    and tokens stay the owner's.
  - Only the owner's runs reach the install's keys or GPU. An account's studio generations run on its own ComfyUI
    through `POST /api/generations`; other runs answer `connect-gpu`, then `own-gpu-tool`.
  - The owner's lists come back empty for a visitor, and a visitor is never told whether one of the owner's records
    exists.
  - New ComfyUI workflows and node packs go into the GPU pre-flight's requirement index (`workflows/comfyui/packs.json`,
    `model-pins.json`, then `node scripts/comfy/build-requirements.mjs`), and new studios and tools get a row on its
    board (`src/server/gpu/tools.ts` `STUDIO_ROWS`).
  - The owner's 10-29 accounts answers (`accounts` in [`handoff/owner-decisions.json`](handoff/owner-decisions.json))
    and accounts-8.md are inputs for the accounts re-plan, not rules for packages.
- **The owner's calls from PR #14** are package `owner-calls-1`, first in lane O:
  - Evolution's cloud route moves onto fal's hosted Wan 2.2 Fun VACE.
  - "Fuobe Speak" keeps its name; the GPU runs FusioniX and the cloud runs without it, and the UI says so.
  - Fuobe DoP stays the Mixed Media default until a blind A/B against Kling 2.5 Turbo with paid keys.

## Waiting on the owner

- **The accounts re-plan.** Accounts are planned again from scratch around public sign-up. accounts-8.md §15's open
  questions (member limits, studio sign-up domains, credits, seats) belong to that re-plan, not to any queued package.
- **Two workflow files the owner shared.** The owner needs to share them again, because they were read in this session's container and not committed: their origin and licence are unknown.
  - `inbetweening/Animation5-In-Betweening.json`, Comfy's "Animation: Keyframes to Full Character Animation", for package `inbetweening`
  - `blockout/Horror_Scene_SD2.5.json`, Comfy's "Horror scene", for package `blockout-film`

  Put them in the inputs folder (below). Both briefs describe what was learned from them, so the packages can start without them and read them once they're back.

## What's left: the queue

Lanes run side by side. Inside a lane, packages run in this order, and each package starts from the integration branch with everything before it merged. Each package goes through four steps:

1. **Implement** in its own worktree, on branch `o/<key>`.
2. **Adversarial review.** The reviewer verifies each finding but doesn't edit.
3. **Fix** the confirmed findings, then run typecheck, lint and the full Vitest run.
4. **Merge.** One integrator at a time merges the package into `claude/fuobe-parity-4`, runs typecheck, lint and Vitest, and pushes.

**Lane R:**
- `n7-2-layout-mode`: Layout mode in the Image studio. Implement and review are done; the fix stage is next.
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

**Lane A** (accounts acc-3 to acc-57) was dropped on 2026-10-30: see "Where things stand". Its branch `o/acc-3` (one
WIP commit) is abandoned; don't build on it.

Each package's full brief, with its research sections, owner rules and test plan, is in `queue.json` under `packages.<key>.brief`.

## Work in progress

Both branches are pushed to `origin` and based on `claude/fuobe-parity-4` at `f7c6d8e`, which still has acc-1 and acc-2.
Rebase each onto the integration branch once it has PR #15 (or merge it in) and drop any use of acc-2's `handler()`,
actor or scope helpers: those modules are gone.

| Branch | State | What the next run does |
|---|---|---|
| `o/n7-2-layout-mode` | 5 commits. Implement and review are done; both reports are in `queue.json` under `done`. | The fix stage. The review found 2 majors (cloud layout runs don't keep fal's seed; a second Edit layout on the same picture does nothing), a weak e2e check, and minors on keyboard resize, contrast and an admin-disabled model. |
| `o/archive-restore` | 6 commits from an implement stage that stopped before it reported. Its two routes (`/api/restore`, `/api/restore/prompt`) use acc-2's `handler()`. | Implement again: the agent resumes from the branch's commits, with plain route handlers under the public sign-up rules. |

The build prompts tell an agent to start from `origin/o/<key>` when that branch exists.

## Setting up a new session

The container starts fresh, so set up the following before building:

```bash
cd /home/user/Fuobe                      # the repository
git fetch origin
git checkout claude/fuobe-parity-4 && git merge origin/main   # after PR #15 merged
for b in o/n7-2-layout-mode o/archive-restore; do git branch -f "$b" "origin/$b"; done
pnpm install --frozen-lockfile && npx next typegen   # typegen before every typecheck in a fresh checkout
(cd scripts/comfy && npm install)                    # playwright-core: the ComfyUI pipeline and tests/comfy-dbs.test.ts
bash scripts/comfy/install-comfyui.sh                # CPU ComfyUI 0.41 + the pinned node packs, outside the repo
timeout 300 bash scripts/comfy/start-comfyui.sh      # http://127.0.0.1:8188; it dies on every container restart
mkdir -p /home/user/ext                              # the inputs folder below
```

**Inputs folder.** Some briefs read files kept outside the repo, in a folder the briefs call `@EXT@` (default `/home/user/ext`). Read them as data: never run or install them. Fetch them again before their package starts:

| Path under `@EXT@` | Package | Source |
|---|---|---|
| `person-remover/` (README, LICENSE, examples) | `person-remover-plus` | https://huggingface.co/akatz-ai/MiniMax-H3-Person-Remover-LoRA |
| `ltx-restore/README.md` | `archive-restore` | https://huggingface.co/Lightricks/LTX-2.5-22b-IC-LoRA-Restore (the model card) |
| `hi3d/README.md`, `hi3d/LICENSE` | `hi3d-refine`, `idol-7` | https://huggingface.co/hi3d-official/Hi3Dv1.0 |
| `inbetweening/Animation5-In-Betweening.json` | `inbetweening` | the owner (see "Waiting on the owner") |
| `blockout/Horror_Scene_SD2.5.json` | `blockout-film` | the owner |

## Running the build

The build runs as a workflow: several agents run with the Workflow tool. A new session runs one only after the owner says so there (for example "use a workflow"). [`handoff/make-workflow.mjs`](handoff/make-workflow.mjs) writes the workflow script from the queue and [`handoff/workflow.body.js`](handoff/workflow.body.js):

```bash
printf '%s\n' '<the commit attribution lines this session was given>' > /tmp/trailer.txt
node docs/handoff/make-workflow.mjs /tmp/fuobe-build.js --trailer-file /tmp/trailer.txt
# then: Workflow({ scriptPath: "/tmp/fuobe-build.js" })
```

- **Options:**
  - `--skip key,key` leaves out packages already merged.
  - `--only R` runs some of the lanes.
  - `--done results.json` reuses stages that finished since the queue was written.
  - `--remove-worktrees` lets the integrator delete merged worktrees. Pass it only if the owner agrees.
- **Size limit.** Scripts must stay under 512 KB. The whole queue comes to about 300 KB.
- **Usage limits and restarts.** A lane stops at the first package that fails a stage, so a relaunch picks up there.
  - In the same session, resume with `resumeFromRunId`: finished agent calls are reused.
  - In a new session, regenerate the script with `--skip` for merged packages and `--done` for finished stages. Agents resume from what their branch already holds.
- **One integrator at a time.** Only the integrator touches the main checkout. Every other agent works in `../wt/o-<key>`.
- **Worktrees take room** (about 1 GB with `node_modules` and `.next`). The disk allowance is fixed per session, so watch `df` and ask the owner before deleting anything.

## Cutting a PR

Only cut a PR when the owner asks for one. The steps that worked for PRs #12 to #15:

1. **Snapshot branch.** Branch `claude/fuobe-r5-batch-<n>` from `claude/fuobe-parity-4`, merge `origin/main` into it, and resolve docs conflicts by keeping both sides.
2. **Verify:** `bash docs/handoff/verify.sh claude/fuobe-r5-batch-<n> /tmp/verify-<n>` (needs ComfyUI running). It runs:
   - typecheck, lint, Vitest, the evaluation cases and the production build
   - every browser check in demo mode
   - hosted prices with a fake fal key
   - the live CPU ComfyUI checks and the workflow library

   It lists any `tests/e2e` script it doesn't run yet. Before fixing a failing check, reproduce it, then show it passing three times on fresh data.
3. **Describe.** Write the PR description from the merged packages' reports: what each area does on each engine, verified vs built, and what needs a GPU or a key.
4. **Docs pass.** Update `docs/STATUS.md`, `docs/ARCHITECTURE.md`, `docs/FEATURES.md`, `docs/SELF-HOSTING.md`, `docs/DEVELOPMENT.md`, `README.md` (a short product page since the owner's rewrite; its "Upgrading" keeps new migrations and dependencies), `docs/research/README.md` and `scripts/comfy/README.md` (library counts) from the reports. Commit it to the snapshot branch.
5. **Open the PR** against `main`, with the checks summary and what none of the checks cover (no GPU, no paid keys).

## Known gaps and gotchas

- **Next.js 16:** run `npx next typegen` before `pnpm typecheck` in a checkout without `.next`, and read `node_modules/next/dist/docs/` before writing Next-specific code.
- **Stopping servers:** the server process is named `next-server`, so `pkill -f "next start"` misses it. Stop servers by port with `fuser -k -n tcp <port>`.
- **Turbopack warnings:** dynamic `fs` paths need `/*turbopackIgnore: true*/`, or Turbopack traces the whole project.
- **ComfyUI on this kind of server:** it accepts all but about ten library workflows. The rest need node packs it lacks:
  - `sfx-thinksound`, `captions-whisper-burnin`, `lipsync-latentsync16` and `image-vectorize-vtracer`
  - the five MiniMax H3 Relay graphs
  - `separate-soundtrack-dbs` (ComfyUI-DBS) on a server installed before DBS D1

  Never install packs or restart ComfyUI from a package agent. Say what's needed instead.
- **What none of the checks cover:** no GPU and no paid key have been used. Every Original is checked in demo mode, on the CPU ComfyUI (graphs accepted, no weights run) and by unit tests, but not for image quality or real bills.
- **The owner's workflow JSONs and downloaded repos:** never commit them, never run them.
