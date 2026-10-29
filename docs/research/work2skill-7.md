# Fuobe research #7: Work2Skill, and skills you can run

_As of 2026-10-29. Machine-readable twin: [`work2skill-7.json`](work2skill-7.json) (`verdict`, `whatItIs`, `claims`, `numbers`, `code`, `dataset`, `relatedWork`, `transfers`, `fuobeToday`, `recipeFormat`, `placements`, `plan`, `risks`, `sources`). Fuobe was read at `claude/fuobe-parity-4` @ `7d7a765`._

**What was asked.** The owner saw this pitch: "turn own desktop demos into reusable procedural skills. with Work2Skill your agent gets +25pp points on real GUI tasks. No more brittle macros. Record once. Run forever with new parameters", with links to the [project page](https://china-qijizhifeng.github.io/Work2Skill/) and the [repository](https://github.com/china-qijizhifeng/Work2Skill). The questions: is it actually good, and how should Fuobe use the idea, creatively.

**How this was produced.** Read-only. The paper ([arXiv 2610.12984](https://arxiv.org/abs/2610.12984) v1, 9 Oct 2026) was read in full from its PDF. The project page HTML and the Hugging Face dataset card were saved and read. The repository was cloned with `--depth 1` into `/home/user/ext/Work2Skill` at `f2ecdc9992749952864d05fb864d670b782dee0a` and its files were read. MyPCBench's README and task list, one third-party write-up, the related papers and three shipping products were read on the web. Fuobe's own code was read at `7d7a765`. No code from Work2Skill was run or installed, and no model was called. Where a number is our own arithmetic and not the paper's, it says "ours". Guesses say "guess".

## 1. The short version

- **Is it good? Partly.** It has real engineering: a recorder that lines up screen video, input events, keyframes and accessibility targets on one timeline, a shared dataset of 350 human demos under CC BY 4.0, and a careful policy for writing skills. The gains are real but modest, and smaller than the pitch says.
- **"+25 pp on real GUI tasks" is the best single cell.** One executor (GPT-5.5), the strict full-credit success rate (SR), on the same 64 tasks that were demonstrated. The apps are mock web apps scored by an LLM judge that the paper doesn't name. SR went from 23.44% to 48.44%. The other three executors gained +6 to +11 pp. On changed versions of the same tasks, GPT-5.5's gain was +9.38 pp. The honest headline: **+4.7 to +10.5 score points on demonstrated mock-app tasks, and +6 to +9 pp SR on changed versions of them.**
- **The OSWorld numbers can't be used.** The dataset card and the project page both say the 286-task OSWorld set was chosen after the results were in: 35 of 321 tasks were dropped where GPT-5.5 scored full marks without skills but not with them. The paper describes a different screening. By our bound, GPT-5.5's SR over all 321 tasks would fall by about 4 pp with skills instead of rising by 7.69.
- **"No more brittle macros" is never tested.** There is no macro or replay baseline, no changed UI layout or app version, no repeated runs and no control where the same model writes a skill from the task text alone.
- **"Record once. Run forever with new parameters" was tested once per task**, on one changed variant in the same mock app. Parameters exist only as prose: there is no schema and no form. Skills are never run before they are used. The paper says its checks "do not verify skill correctness or task success".
- **The code is a research release.** MIT, 5 commits, all on 12 Oct 2026: a macOS recorder and an induction example that needs an outside agent framework (NexAU). It ships no execution runners, no judge, no induced skills and no result files, so no table in the paper can be reproduced today. Two GitHub issues asking for the skills have no reply.
- **The idea isn't new.** Agent Workflow Memory (2024) and ASI (2025) came first. ASI verifies its skills by running them, the step Work2Skill leaves out. Claude's "Record a skill", OpenAI's Record & Replay and Microsoft's open-source Skill Recorder already offer this to users.
- **For Fuobe: keep the idea and the writing rules, and drop the pixels.** Fuobe already keeps an exact record of what a user did: each generation's request, what it waited for, and every tool call Assist made. So Fuobe can build a skill from that record with no screen recording and no LLM, give it typed inputs, check it by running it for free before saving it (ASI's lesson), and run it again with new inputs from a form, Assist, MCP, the CLI, a schedule or the Canvas.
- **Build plan (§10).** P0: **W1** "Run a skill with new inputs" and **W2** "Make a skill from what you made". P1: **W3** Assist saves and runs skills, **W4** skills on a schedule and in the CLI. P2: **W5** skills as canvases, **W6** Fuobe suggests skills and keeps them working, **W7** skills that span studios. No screen recorder.

## 2. What Work2Skill is

Sources: the paper (Sec. 3, App. A–E), the repository at `f2ecdc9`, the dataset card. Authors from Shanghai Jiao Tong, Fudan, NTU, Zhejiang University and Shanghai Qiji Zhifeng Co.

| Part | What it does | Where |
|---|---|---|
| **WorkRecorder** | A native macOS app with a local daemon. It records screen video, mouse and keyboard events, keyframe images, and accessibility (AX) data where an app exposes it. Linux targets are recorded from a Mac watching the remote desktop over TigerVNC, with an X11 AT-SPI collector inside the target that supplies element names, roles and bounds. Everything sits on one video timeline: raw events are grouped into actions (click, drag, scroll, hotkey), and each action is linked to a keyframe and a target element. | `WorkRecorder/` (698 files: Python packages, a Swift app, a daemon, a browser provider, OCR through an OpenAI-compatible endpoint or Apple Vision, a Feishu integration, the Linux collector, tests) |
| **An episode** | One demo: `task.json` (the real task instruction), `episode.json`, `trace/actions.jsonl`, a raw keylog, `evidence/*.png` with a manifest, `video.mp4` and `summary.md`. | paper Sec. 3.1; dataset card |
| **WorkDemo-350** | 350 human demos, about 8.48 h. 64 are MyPCBench's whole Bounded Action set (64 of its 184 tasks): a Linux VM with 17 mock web apps that copy consumer products (TableFind, Dinoco Airlines, BatBucks, HooliMail…), filled with generated data, plus LibreOffice. 286 are OSWorld-Verified tasks on real desktop apps. | paper Table 1; [MyPCBench README](https://github.com/ljang0/MyPCBench) and `tasks/final/task_types.json` |
| **Induction** | A NexAU tool-using agent: an image-capable LLM at temperature 0, high reasoning effort, up to 100 iterations, 200k context, 16k output per call. It loads a short system prompt and a bundled "skill-creator" authoring policy, browses the evidence on demand (`list_directory`, `glob`, `read_file`, `read_visual_evidence`, `get_video_metadata`, `watch_video`, `extract_video_frames`) and writes one or more `SKILL.md` files in the Agent Skills format (YAML `name` and `description`, then prose). | `AgenticSkillInduction/agent.yaml`, `system_prompt.md`, `skills/skill-creator/SKILL.md`, `bindings.py` |
| **"Verification"** | `finalize_extraction` checks structure only: `task.json` was read, the front matter is valid, each `SKILL.md` was read back after its last write, video metadata was read before frames were sampled. It warns on coordinates, machine paths and timestamps. "Candidate skills are not executed during induction", and the checks "do not verify skill correctness or task success". | `bindings.py` L658–855 (warnings L678–696); paper Sec. 3.3 |
| **Run time** | The whole `SKILL.md` text is appended in a `<task skills>` block at the end of the executor's system prompt. The executor is a screenshot-plus-PyAutoGUI computer-use loop (MyPCBench also allows Bash), at temperature 0, high effort, a 100-step limit and a 3-screenshot window. It never sees the recording. Executors: GPT-5.5, Opus-4.8, Qwen3.5-35B-A3B, Qwen3.5-9B; by default the same model induces and runs the skill. | paper Sec. 4.1, App. D |

**The authoring policy** (`skills/skill-creator/SKILL.md`, MIT) is the most reusable part. In its own words: "Separate Procedure from Trace", "Treat the task instruction as the goal and the recording as fallible evidence", "Parameterize episode-specific values without abstracting away the formula, threshold, relationship between inputs, requested count, ordering constraint, selection rule, or visible verification that makes the procedure correct", "Use semantic UI targets instead of fixed coordinates", keep "visible checks after critical mutations and a final observable completion check", and "Never invent a hidden rubric or success condition". It also says "Never substitute an API, database edit, script … unless the authoritative task explicitly requires that mechanism". That last rule is the opposite of what Fuobe wants (§6).

## 3. The claims, checked against the paper

### 3.1 The numbers that matter

Paper Table 2 (originals, N = 64) and Table 3 (the changed "Jitter" twins, N = 64). Score is 0–100, SR is the share of tasks given full credit. Both from one run each at temperature 0.

| MyPCBench | GPT-5.5 | Opus-4.8 | Qwen3.5-35B-A3B | Qwen3.5-9B |
|---|---|---|---|---|
| Score, no skill → Work2Skill | 74.73 → 85.27 (+10.54) | 81.53 → 86.20 (+4.67) | 38.38 → 44.56 (+6.18) | 24.27 → 34.11 (+9.84) |
| SR, no skill → Work2Skill | 23.44 → 48.44 (**+25.00**) | 42.19 → 50.00 (+7.81) | 9.38 → 20.31 (+10.93) | 6.25 → 12.50 (+6.25) |
| Best demo baseline (Aloha or D2T), SR | 37.50 | 42.19 | 12.50 | 6.25 |
| Steps, no skill → Work2Skill | 40.89 → 47.38 | 40.58 → 36.03 | 56.28 → 46.69 | 70.92 → 69.30 |
| Induction tokens per task (k) | 334.52 (Aloha 170.65, D2T 177.32) | 300.21 | 245.63 | 249.87 |
| **Jitter** score | 73.45 → 81.75 (+8.30) | 83.30 → 87.23 (+3.93) | 42.94 → 51.58 (+8.64) | 27.80 → 36.25 (+8.45) |
| **Jitter** SR | 37.50 → 46.88 (+9.38) | 45.31 → 54.69 (+9.38) | 12.50 → 21.88 (+9.38) | 6.25 → 12.50 (+6.25) |

**Evidence ablation** (Fig. 5a, GPT-5.5, 64 tasks; values read from the figure). Full evidence 85.27 / 48.44% SR. Action text with UI target descriptions only: 79.09 / 37.50%. Video only: 75.81 / 28.13%. Without the indexed keyframes: 74.64 / 32.81%, which is below no skill (74.73). So the gain comes from structured, annotated evidence, not raw pixels. Action text alone carries about 40% of the score gain and 56% of the SR gain (ours). **Agentic browsing vs a fixed prompt** (Fig. 5b, Sec. 4.5): the default prompt beats a prescribed "Pipeline Prompt" by 3.97 score points and 6.25 pp SR (85.27 vs 81.30; 48.44% vs 42.19%) at 12.7% more induction tokens.

**Cross-model** (Fig. 4): skills induced by Qwen3.5-9B give GPT-5.5 +1.08 score but +15.62 pp SR. Skills induced by GPT-5.5 give Qwen3.5-9B +12.39 score, more than its own (+9.84), but its absolute score stays at 34 to 37.

### 3.2 Claim by claim

| Claim | What the evidence shows | Holds up? | Why |
|---|---|---|---|
| "With Work2Skill your agent gets +25pp on real GUI tasks" | +25.00 pp is GPT-5.5's SR on the 64 MyPCBench tasks, each with a skill induced from a demo of that same task (Table 2, Fig. 4). Other executors +6.25 to +10.93 pp; mean score gains +4.67 to +10.54. MyPCBench is mock web apps with generated data, scored by an offline LLM judge over weighted rubrics (MyPCBench's default judge is Gemini 3.1 flash-lite preview; the paper doesn't say which it used). On the Jitter twins GPT-5.5's gain is +9.38 pp. No repeated runs, seeds, variance or confidence intervals. The +25 figure is on neither the project page nor the explainx write-up. | **Partly** | The number exists, but it is the best cell: the best-gaining model, the strictest metric, on tasks that were themselves demonstrated. "Real GUI tasks" is wrong for this cell. Ours: one SR on 64 tasks has a standard error of roughly 6 pp, so a net 16 tasks (+25 pp) is probably a real effect for that cell, while +6 to +11 pp cells are within plausible run-to-run noise. (The 14 pp gap between 23.44% on the originals and 37.50% on the twins is not a noise estimate: 331 of 366 rubric items were rewritten.) |
| Work2Skill wins on real desktop apps (paper and page: +3.11 to +7.50 score, +1.40 to +7.69 pp SR on OSWorld-Verified) | The project page and the dataset card: "a post hoc OSWorld selection: 286 of 321 recorded tasks were retained after excluding 35 tasks where GPT-5.5 scored 1 without skills but less than 1 with v6 skills. This selection affects estimates of improvement." The paper (Sec. 3.2, App. E) describes only dropping infeasible tasks and failed demos. The card adds that it "does not claim a documented manual high-quality selection process". GPT-5.5 on the 286: 74.47 / 70.98% (203 tasks) without skills, 81.97 / 78.67% (225 tasks) with. | **Can't be verified, and likely overstated** | The dropped tasks are exactly those where skills hurt the best model. Ours, assuming the final skills did on those 35 what the "v6" skills did: over all 321 tasks GPT-5.5's SR goes from 74.1% to 70.1% with skills, about −4 pp; its score gain vanishes if the skills averaged below about 0.39 on those 35. The final skills may differ from v6, so this is a bound, not a result. Don't cite any OSWorld number until the 321-task results are published. |
| "Turn your own desktop demos into reusable procedural skills" | You can record on a Mac and induce with your own image-capable, OpenAI-compatible endpoint. Linux targets need a Mac plus the X11 collector. The induction example must be copied into an outside NexAU checkout (Python 3.12+, uv, ffmpeg). README: live cross-platform acceptance testing is "pending"; extraction quality isn't validated end to end. Every demo in the paper is a benchmark VM task with a `task.json` written for it. The paper's induced skills aren't released (issues #1, #2 open, no reply). No consent records in the dataset. | **Partly** | Possible for a researcher, not a product. Quality evidence exists only for benchmark VMs. Products already do this for end users (§5). |
| "No more brittle macros" | Skills are prose with semantic targets; the validator warns on coordinates, paths and timestamps; the policy bans replaying the trajectory. Not tested: a macro or replay baseline, the parameterised-workflow replay work the paper cites (Zhao et al. 2026), a changed UI layout or app version, repeated runs over time, or a skill written from the task text alone. The baselines are other demo methods cut down to text (ShowUI-Aloha keeps only its `caption.action` lines; Demo2Tutorial loses its images, App. E.4). Even with skills, Jitter SR stays between 12.5% and 54.7%. | **Can't be verified** | Prose read by an LLM avoids hard-coded coordinates, so it should survive layout changes better than a click macro. That is a fair design argument the paper never tests. Without a task-text-only control we can't tell how much comes from the demo and how much from the policy plus the model's own knowledge. The agents still fail most hard tasks: differently brittle, not unbrittle. |
| "Record once. Run forever with new parameters" | RQ2, MyPCBench Jitter (Table 3, App. E.1): each original task gets exactly one variant in the same app with changed entities, numbers, rules or required end state; instructions and rubrics drafted with GPT-5.6-sol and checked by people. Reusing the original skill beats no skill by +3.93 to +8.64 score and +6.25 to +9.38 pp SR, all four executors. Against the stronger demo baseline the score lead is +4.28 to +6.25. Parameters aren't explicit: the executor reads new values from the task text. | **Partly** | Reuse with new values works, modestly and consistently, for one change in the same mock app. "Forever" is untested (no time, app versions or other apps). With no parameter schema or form, the agent has to work out the parameters from prose on every run. |
| Works for "your agent" | Four executors, gains depend on the model; the strongest base model gains least (Opus-4.8 +4.67 score on MyPCBench). Cross-model transfer was tested only between GPT-5.5 and Qwen3.5-9B. Induction costs 185k to 335k tokens per task, 1.9× the baselines for GPT-5.5 on MyPCBench (334.5k vs 170.7k / 177.3k). With skills GPT-5.5 takes more steps; the others take fewer. | **Partly** | Plain-text skills plug into any harness. How much they help depends on both models, and it shrinks as the executor gets stronger. Good induction is expensive. |

**Other things a reader should know.** The dataset card mentions "v6 skills", which suggests the method was revised against the evaluation tasks (our inference). The paper has no limitations section. Agent Workflow Memory isn't cited.

## 4. The code, the data and the licences

**Repository** ([github.com/china-qijizhifeng/Work2Skill](https://github.com/china-qijizhifeng/Work2Skill)). Read at `f2ecdc9992749952864d05fb864d670b782dee0a` ("docs: introduce project website before paper and dataset links", 2026-10-12 21:34 +0800). Five commits, all on 2026-10-12, one author; the first is "Initial sanitized Work2Skill release". The GitHub page on 2026-10-29: 38 stars, 6 forks, 2 open issues, no releases. Issue [#1](https://github.com/china-qijizhifeng/Work2Skill/issues/1) "Request for Release of Induced Skills Used in the Experiments" (2026-10-20) and [#2](https://github.com/china-qijizhifeng/Work2Skill/issues/2) "生成skill咨询" ("could you share a generated skill?", 2026-10-21) have no comments.

| Folder | What's there |
|---|---|
| `WorkRecorder/` | The macOS app and daemon, recorder Python packages, the Linux AT-SPI collector (adapted from OSWorld, Apache-2.0), OCR enrichment, tests |
| `AgenticSkillInduction/` | 2,096 lines of Python incl. 112 lines of offline tests: `bindings.py` (tools and the structural validator), `start.py` (clears `HTTP(S)_PROXY` and `ALL_PROXY`, so the endpoint must be directly reachable), `batch_start.py`, a Streamlit dashboard, `system_prompt.md`, `skills/skill-creator/SKILL.md`, nine tool YAMLs, `agent.yaml` (temperature 0, 200k context, 100 iterations, 16k output) |
| `DownstreamTasks/` | `tasks-jitter.json` (64 changed tasks, 366 weighted rubric items, all `llm_judge`) and `selected_task_ids.json` (the 286 OSWorld ids) |

**Missing, compared with the paper:** the execution runners, the OSWorld harness, the MyPCBench environment setup, the perturbation generator, the judge configuration (the judge model is never named), end-to-end results, the 35 excluded OSWorld results and the induced skills. No table in the paper can be reproduced from the repository today.

**Needs to run:** NexAU (not bundled), Python 3.12+, uv, ffmpeg/ffprobe, and an image-capable model with structured tool calls behind an OpenAI-compatible Chat Completions endpoint. Recording needs a Mac with Accessibility permission. Re-scoring MyPCBench needs its environment and an LLM judge.

**WorkDemo-350** ([Hugging Face card](https://huggingface.co/datasets/yuqi777/WorkDemo-350), read 2026-10-29): 13.93 GB, 11,202 files, created 2026-09-21, last changed 2026-10-12, 1,616 downloads. It keeps all 350 raw keylogs; the card reports email addresses and password-related text in them and says the package "is not claimed to be fully anonymized". No consent records and no per-task acceptance records; "`status=completed` describes recording status, not evaluator-confirmed task success". No VM images and no complete evaluator: the OSWorld task files have their evaluator fields removed.

**Licences, as written (information, not a gate):** code MIT ("Work2Skill contributors"); `THIRD_PARTY_NOTICES.md` keeps MyPCBench's MIT licence and OSWorld's Apache-2.0 for the adapted collector, and MyPCBench's licence for `tasks-jitter.json`; WorkDemo-350 CC BY 4.0. Fuobe may adapt the authoring policy text with credit (MIT). Fuobe needs none of the code.

## 5. Related work and products

| | What it is | What it shows | Source |
|---|---|---|---|
| Agent Workflow Memory (2024) | Induces reusable workflows from agent trajectories, online and offline | +24.6% and +51.1% relative success on Mind2Web and WebArena. Not cited by Work2Skill | [arXiv 2409.07429](https://arxiv.org/abs/2409.07429) |
| ASI, Agent Skill Induction (2025) | Induces skills as **programs** and verifies them by running them | +23.5% over a static agent and +11.3% over its own text-skill variant in success rate on WebArena, "mainly thanks to the programmatic verification guarantee". Cited by Work2Skill | [arXiv 2504.06821](https://arxiv.org/abs/2504.06821) |
| SkillWeaver | Skills discovered and honed by web agents | Cited by Work2Skill | paper references |
| Claude "Record a skill" | Cowork in Claude for Mac (Pro, Max, Team) | A shipping product | [Claude help](https://support.claude.com/en/articles/12512198-how-to-create-custom-skills) |
| OpenAI Record & Replay | ChatGPT desktop and Codex on macOS | Drafts a skill with its inputs, steps and how to check the result | [OpenAI docs](https://learn.chatgpt.com/docs/extend/record-and-replay) |
| Microsoft Skill Recorder | Open source, MIT | Its generated skills prefer the agent's own tools (`gh`, `web_fetch`) over replaying clicks | [github.com/microsoft/skill-recorder](https://github.com/microsoft/skill-recorder) |

So Work2Skill's new parts are the recorder, the dataset and on-demand evidence browsing, not the idea of skills from demos. ASI's result is the one that matters most for Fuobe: **checked, executable skills beat prose skills**, and Work2Skill doesn't check.

## 6. What transfers to Fuobe, and what doesn't

**Transfers:**

1. **The loop**: something done once → a reusable procedure → a run with new inputs. In Fuobe the "demo" is work the user already did: a Library result and the chain behind it, a multi-select of results, an Assist chat whose plans ran, or a canvas.
2. **"Procedure, not trace"**, as the skill builder's rules: uploads, subject words and counts vary; models, settings, prompt scaffolding, step order, chain slots and dependencies stay fixed; generalise a value without losing how it relates to others; never invent a success condition.
3. **Completion checks stored in the skill.** For media they're structural: output kind, count, aspect, duration and whether there's sound, all readable today (`OutputFile.width/height`; `probeMedia` in `src/lib/media-probe.ts` for duration and `hasAudio`). An optional "look" sentence can be judged by a vision model, but `check_generations` with `look: true` attaches finished images only (up to 4), so a video needs a frame first.
4. **The ablation's lesson, used carefully.** Structured evidence beats raw video. Fuobe's case is stronger than the paper's: its records are the exact requests, not descriptions of clicks (`generations.request_json`, `depends_on`, `ChainSlot`, and Assist's `tool_use` inputs in `assist_threads.messages_json`). So building a skill can be deterministic and cost no tokens, with an optional small LLM pass that names inputs and writes the prose.
5. **On-demand evidence**: the LLM looks at outputs only when it must write a check or a name.
6. **The Agent Skills format**, which Fuobe already uses.

**Add what Work2Skill lacks:** typed inputs (so a "Run…" form can be generated), execution checks before saving (ASI), and deterministic replay through `createPipeline`, so running a saved skill needs no LLM and works for offline-planner and Ollama users. (In the paper, Qwen3.5-9B with skills still scores only 34 to 37.)

**Doesn't transfer:** pixel GUI agents, screen video, keyframes, AX trees, keylogs, WorkRecorder and NexAU (Fuobe's own actions are API calls); the "preserve the GUI, never use an API" rule (Microsoft's Skill Recorder takes Fuobe's side); prose-only parameters; and the benchmark numbers, which say nothing about creative media pipelines. Don't quote the OSWorld numbers anywhere.

**A trap Fuobe has that GUI work doesn't: some work changes shape with its input.** Replaying the frozen, expanded graph of these with an input of another length is wrong:

| What expands | Where | How to tell |
|---|---|---|
| Multi-shot films on open models, Frames films, extend on models with no extend API, open text-to-3D, DoP relight | `createGenerations` calls `createShotFilm`, `createKeyframeFilm`, `createExtendChain`, `createStillTo3d`, `createRelitClip` (`src/server/generations.ts`, `src/server/chains.ts`); the request as asked isn't stored on the rows | shared batch, step labels ("Shot i of n", "Film · n shots", "Frames a → b", "Last frame / Continuation / Extended video", "Still / 3D model", "Relit start frame / Relit clip") |
| Per-frame Mixed Media | one step per frame with `ChainSlot.index` | `request.chain[].index`; features ending in `-step` (`isHelperFeature`, `src/lib/library.ts`) |
| Storyboards, Faceless scenes, ads batches, dubs, Katana | the studio plans the steps from its input | `request.frame`; `generations.feature` (storyboard, storyboard-film, faceless-*, ads, ad-multiplier, click-to-ad, dub, katana…) |

The procedure for these is the request as asked, or the studio-level call (`faceless_episode`, `create_ads`, `dub_video`, `katana`…), not the expanded steps. Don't use `request.step` to detect them: `createPipeline` stamps a step label on every pipeline step. This is the paper's "procedure vs trace" made concrete.

## 7. Fuobe today

Read at `7d7a765`; every file named exists.

- **Skills.** 20 built-in playbooks in `skills/*/SKILL.md`, Agent Skills format, Fuobe's fields under `metadata` (`skills/README.md`, checked by `tests/skills-spec.test.ts`). `src/server/skills.ts` reads built-ins from disk and keeps user skills in the `skills` table with bundled text files in `files_json`: up to 30 files, 400 KB in all, `.json` included (`TEXT_FILE`, `MAX_FILES`, `MAX_FILES_BYTES`), so a `recipe.json` fits with no migration. Import takes `.md`, `.zip` and `.skill`. `createSkill` and `updateSkill` don't write files (only import and duplicate do). **Download drops the bundled files**: `src/app/api/assist/skills/[name]/download/route.ts` returns `SKILL.md` only (`skillMarkdown` → `toSkillMd`), and `fuobe skills show` reads that route. `RESERVED` names are `upload` and `new` (static routes beside `[name]`).
- **A file-safety catch.** `skills.files_json` is listed in `ASSET_FREE` ("a skill's own text files, stored inline") in `src/server/generations.ts`, so Empty trash would delete a file that only a recipe names. Recipes must move it to `ASSET_REFS`.
- **Assist.** `src/lib/assist.ts`: `SkillMeta`, `parseSkillMd`/`toSkillMd`, `/name` loading, `PlannedJob.atomic`, agents `claude | ollama | offline` (rule-based, no LLM). `src/server/assist/context.ts` lists up to 60 skills (`SKILL_INDEX`); `context-tools.ts` has `list_skills` (word-count match), `load_skill`, `remember`, `read_source`. `src/server/assist/tools.ts`: `generate` (1–6 jobs; `after` chains a job to one earlier job and makes the whole call one `createPipeline`; `batchTitle` groups them), `search_models`, `list_elements`, `list_recent`, `check_generations` (`look` attaches at most 4 finished images), `create_storyboard`, `katana`; `TOOLS.push(...CONTEXT_TOOLS, ...STUDIO_TOOLS)` at line 543; `planFor` and `executeTool` price and run any tool with a `ToolContext` that is just `{ engine, thread? }`. `src/server/assist/studio-tools.ts`: `split_layers`, `restyle_footage`, `dub_video`, `faceless_episode`, `create_ads`, `add_captions`, each run through its studio's `STUDIO_ROUTES` entry (`studio-routes.ts`) and falling back to `createPipeline`; `planSteps` prices pipeline steps.
- **Assist's records.** `assist_threads.messages_json` holds the Anthropic-shaped history with every `tool_use` input and its `tool_result` for all three agents (Ollama's are converted at call time, `toOllamaMessages`). Approval items in `items_json` say approved / declined / pending; a declined call gets an `is_error` result. **Auto-run calls have no approval card**, so a chat's successful calls must be read from the `tool_use`/`tool_result` pairs, not the cards.
- **Scheduled tasks.** `src/lib/assist-schedule.ts`, `src/server/assist/schedules.ts`: each run is a new chat planned by that chat's agent; ask-first or auto within a cap (default $2). `startSchedule` already accepts a `model` override. Schedule button in `src/components/assist-view.tsx`; dialog `src/components/assist/schedule-dialog.tsx`.
- **MCP.** `src/server/mcp.ts` (`/api/mcp`, 1.2.0) serves every tool in `TOOLS`, plus `estimate_cost` and `estimate_job` (which prices any gated tool with a `plan`), and serves skills as prompts. No skill-run tool and no canvas tool.
- **CLI.** `bin/fuobe.mjs`, `bin/lib/commands.mjs`, `bin/lib/skills.mjs`: skills `list`, `show`, `add`, `enable`, `disable`. No `skills run`.
- **Pipelines.** `createPipeline` (`src/server/chains.ts`) takes a DAG of `{key, request, after, chain}`, orders it (`topoOrder`), validates every step with `previewChained` before creating anything, refuses a mix of demo and real steps, requires a step that feeds later steps to make one job, takes `existing` ids to link to, cancels a half-made pipeline on failure, and stamps `request.step` on every step.
- **Generations.** `request_json`, `depends_on`, `batch_id`, `feature`. `currentRequest` moves retired models (`REPLACED_BY`, `src/lib/catalog/replaced.ts`); `unfilledRequest` removes chain-filled inputs (retries use it); `chooseRoute` reads the global Demo mode setting (auto/on/off, `src/server/settings.ts`); there is no per-run demo switch. The runner already forces a step to the demo provider when its dependencies ran as demos (`chainMode`), except when Demo mode is Off.
- **Canvas.** Ports: prompt, elements, images, endImage, video, videos, audio, voice. A Table node has text rows only (50 rows × 8 columns, `TABLE_LIMITS`) and feeds Text inputs; runs go through `runCanvas` (`createPipeline`). Assist, MCP and the CLI can't reach a canvas.
- **Library.** Multi-select and Select all with a bulk bar (`src/components/library-view.tsx`); the result ⋯ menu comes from `src/lib/output-actions.ts`; Reuse loads one generation's request back into the composer, it doesn't replay a chain.
- **Status.** `docs/STATUS.md` line 204: "Assist hasn't talked to a live model". Line 172: Genjutsu, Remove object, Content Factory, the AI Influencer builder and parts of Layers have no Assist or MCP tool.

**Gaps:** no typed skill inputs; no way to run a whole chain or a chat's plan again with new inputs; schedules can't run a fixed procedure without an agent; skills are guidance only, never executable; downloads lose bundled files.

## 8. Where it goes in Fuobe, and why

Placed where people already work: the result they like, the Library selection, the chat that worked, the Skills page, the schedule dialog, the Canvas list. No new top-level page.

| Priority | Where | User story | Why here |
|---|---|---|---|
| **P0** | Skills page: **Run…** on a skill with a recipe (`src/components/assist/skills-view.tsx`), a new `run-skill-dialog.tsx`; `src/lib/recipe.ts` + `src/server/recipes.ts` | "I open my turntable skill, drop in a new product photo, type the name, see the price and press Run. Or I paste 20 rows." | The Skills page is where skills live; the form is the "new parameters" part done properly |
| **P0** | Result ⋯ menu "Make a skill from this…" (`src/lib/output-actions.ts`), Library bulk bar "Make a skill" | "I pick the result I liked; Fuobe rebuilds the steps behind it, asks what changes next time, checks it and saves it. I never had to record anything." | Retroactive: the record already exists |
| **P0** | Checks before saving: plan on each engine, a free dry run on the demo provider (a new per-run `demo` flag), an optional paid test; "Needs a re-check" when the catalog moves | "Before I trust a skill, Fuobe proves it runs, for free, and tells me when a model change breaks it." | ASI's lesson; Work2Skill's gap |
| **P1** | Assist header and chat ⋯ menu "Save as skill"; a gated `run_skill` tool (Assist, MCP, offline planner) | "The chat finally made the dub-and-caption flow I wanted. Next time I say 'do the dub thing for this clip' and get one priced card." | Assist already has the exact tool calls |
| **P1** | Schedule dialog "What to run: A request / A skill"; `fuobe skills run` | "Every Monday my promo skill runs on the newest upload with no LLM in the loop; a teammate runs it from the CLI with a CSV." | Deterministic, cheap, testable |
| **P2** | Canvas list **Skills** tab and "Save as skill…" in the editor | "I open a skill as a canvas to tweak it, or turn a canvas into a skill with a form." | Makes canvases reachable from MCP, the CLI and schedules |
| **P2** | Library suggestion card; run history; fix suggestions; ranked `list_skills` | "Fuobe notices I made the same chain four times and offers to save it." | AWM-style online induction |
| **P2** | Studio-spanning skills (a studio step that feeds later steps) | "Dub, then captions, then a 9:16 cut, as one skill." | Needs a waiting orchestrator |
| Later, only if asked | A Record toggle (sidebar, ⌘K) stamping a session id on new generations | "I press Record, work across studios, press Stop, get the same review screen." | The Library builder covers most of it; never capture the screen |

## 9. The recipe format (`recipe.json`)

A recipe is one text file inside a user skill (`skills.files_json`), next to `SKILL.md`. `SKILL.md` stays the human and agent-readable playbook; `recipe.json` is the part Fuobe runs. A skill has a recipe when its files include a valid `recipe.json`. Illustrative example (model ids as in Fuobe's catalog and docs):

```jsonc
{
  "fuobeRecipe": 1,
  "params": [
    { "id": "product", "label": "Product photo", "type": "image", "required": true, "example": "/api/files/uploads/2026-10-20/lamp.png" },
    { "id": "name", "label": "Product name", "type": "text", "required": true, "example": "Lumen desk lamp", "max": 200 },
    { "id": "aspect", "label": "Shape", "type": "choice", "options": ["1:1", "9:16", "16:9"], "default": "1:1" },
    { "id": "takes", "label": "Takes", "type": "number", "min": 1, "max": 4, "default": 1 }
  ],
  "steps": [
    { "key": "cutout", "kind": "generate",
      "request": { "feature": "skill", "modelId": "birefnet-cloud", "op": "bg-remove", "inputs": { "images": ["{{product}}"] } } },
    { "key": "scene", "kind": "generate", "after": ["cutout"], "chain": [{ "slot": "images", "position": "first" }],
      "request": { "feature": "skill", "modelId": "nano-banana-pro", "op": "edit", "prompt": "{{name}} on a travertine plinth, soft window light", "params": { "aspectRatio": "{{aspect}}" } } },
    { "key": "spin", "kind": "generate", "after": ["scene"], "chain": [{ "slot": "images" }],
      "request": { "feature": "skill", "modelId": "kling-3", "op": "i2v", "prompt": "slow turntable of the {{name}}", "params": { "duration": 5, "numOutputs": "{{takes}}" } } }
  ],
  "checks": { "spin": { "kind": "video", "count": "{{takes}}", "aspect": "{{aspect}}", "seconds": [4.5, 5.5], "sound": false, "look": "the product turns on a plain plinth" } },
  "verified": { "cloud": { "plan": "2026-10-29", "dryRun": "2026-10-29", "real": null, "catalog": "sha256:…" }, "open": null },
  "source": { "from": "library", "generations": ["V1StGXR8_Z5j", "3Kp9x2LmQa7c", "Qa7cV1StGXR8"], "at": "2026-10-29" }
}
```

- **Params** are typed: `image`, `video`, `audio`, `text`, `number`, `choice`, `element` (an @handle of a saved element). Each has `required`, `default`, `example` (the value from the original run), and limits (`max` length, `min`/`max`, `options`). Media values are Fuobe file URLs (`/api/files/…`) or http(s) URLs, which generations already read through `readRef` → `remote-fetch.ts`.
- **Steps** are either `generate` (a `GenerationRequest` with `after`/`chain` exactly as `createPipeline` takes them) or `tool` (one call of a gated Assist tool: `{ "tool": "dub_video", "input": { … } }`). Version 1 runs either a DAG of generate steps (one `createPipeline`) or one tool step. A tool step feeding later steps is W7.
- **Placeholders**: a string that is exactly `"{{id}}"` takes the value with its type; `{{id}}` inside a longer string inserts the text. Only param ids are allowed. Unknown or unused placeholders are refused when the recipe is saved, never at run time. Step outputs travel only through `after` and `chain`.
- **Count** (`numOutputs`) may vary only on steps nothing waits for (the `createPipeline` rule).
- **Checks** are per step and structural (kind, count, aspect, seconds, sound), plus an optional `look` sentence for a vision model.
- **`verified`** per engine: the date of the plan check, the dry run and the optional real test, and a hash of each step's model, operation, route provider and price. A different hash, a step moved by `REPLACED_BY`, or a model switched off in Settings → Models & licences means "needs a re-check". It's computed when read; no background job.
- **Runs** stamp each request with a server-set `skill: { name, run }` (in `request_json`, no migration) and `batchTitle` = the skill's title, so the Library groups a run and history can be read back.
- **Engines.** A recipe runs on the engines whose plan check passed: a Fuobe Original on both, any other model on its own. Fuobe never swaps models between engines by itself (the owner's rule: a cloud route only where the model is actually hosted). Licences show as information in the form; the Models & licences switches apply as they do everywhere.

## 10. Build plan

Packages in priority order, one per natural feature. W1 and W2 are P0 and ship together; each later package builds on W1's runner. Every package: typecheck, lint, the full vitest suite and the browser checks pass; demo mode works without keys; `docs/STATUS.md`, `docs/ARCHITECTURE.md` and `docs/cli.md` (when the CLI changes) are updated. Before writing route handlers, read the Next.js guide in `node_modules/next/dist/docs/` (this repo's Next.js differs from older versions; `AGENTS.md`) and follow the existing routes' pattern (`RouteContext<…>`, `await connection()`).

### W1 · Run a skill with new inputs (P0)

**Goal.** A user skill can carry a recipe (§9). Fuobe runs it with new inputs from a generated form, with no LLM, after pricing it, on any engine where it was checked. A recipe is checked by running it before it's trusted. This is "record once, run with new parameters" done Fuobe's way: typed, priced and verified.

**User story.** "I open my 'Lamp turntable' skill, drop in a new product photo, type the name, see '$0.62 on Cloud' and press Run. Or I paste 20 rows and see '$12.40 for 20 runs'."

**Skill format.** A recipe skill is an ordinary user skill: `SKILL.md` in the `skills/` conventions (`name`, `description`, Fuobe's fields under `metadata`: `title`, `when_to_use`, `icon`, `studio`, `tags`; see `skills/README.md`) plus `recipe.json` (§9) in its files. Don't add front-matter fields: a skill has a recipe when its files include a valid `recipe.json`, so its `SKILL.md` still loads unchanged in Claude Code and other agents. A generated body follows the built-in playbooks' layout and ends with "## Using Fuobe from an agent" (the `run_skill` call from W3 and, as a fallback, the equivalent `generate` or studio tool calls).

**Pure module `src/lib/recipe.ts`.**
- `RecipeSchema` (zod): `fuobeRecipe: 1`, at most 12 params and 24 steps (guess at sane caps), checks, verified, source.
- `valuesSchema(recipe)`: a zod object for one set of values (required, defaults, limits, options; media must be a Fuobe file URL or http(s) URL; `element` must look like an @handle).
- `recipeProblems(recipe)`: save-time checks (unknown or unused placeholders, a `numOutputs` placeholder on a step that feeds others, duplicate keys, a tool step that isn't alone).
- `fill(recipe, values)` and `compile(recipe, values, { skill, run, title })` → `{ kind: "pipeline", steps: PipelineStep[] }` or `{ kind: "tool", tool, input }`. Every request gets `batchTitle` and the server-set `skill` stamp.
- `parseRows(csv, recipe)`: header by param id or label, quotes, BOM, empty rows skipped, at most 50 rows (as `TABLE_LIMITS.rows`), errors per row.
- `checkOutputs(check, outputs, infos)`: kind, count, aspect from width/height (±2%), seconds, sound. Pure: it takes the `MediaInfo`s.
- `stripExamples(recipe)` for export; `recipeMarkdown(recipe)`: a "Run it" section listing the params and, for other agents, the equivalent `generate` or studio tool calls.

**Server `src/server/recipes.ts`.**
- `getRecipe(name)` via `skillFile(name, "recipe.json")` + `RecipeSchema`; `saveRecipe(name, recipe)` through a new `setSkillFile(name, path, content)` in `src/server/skills.ts` (user skills only, "Duplicate it first" for built-ins; keeps `MAX_FILES` / `MAX_FILES_BYTES`).
- `estimateRecipe(name, valuesOrRows, engine)`: pipeline → `planSteps("run_skill", steps)` (`studio-tools.ts`); tool → `planFor(tool, input, { engine })` (`tools.ts`). Rows are priced together and returned with a total.
- `runRecipe(name, valuesOrRows, engine)`: pipeline → one `createPipeline` per row (every row validated first; one bad row starts nothing); tool → `executeTool(tool, input, { engine })`. Returns `{ runs: [{ batchId, ids, href? }] }`.
- `verifyRecipe(name, level, engine)`:
  1. `plan`: compile with the examples (a stand-in file URL for a media param with none, as the CLI's `estimate` does) and estimate on each engine the steps allow. Free.
  2. `demo`: one run with every job forced to the demo provider. The compiled requests carry a new server-set `demo: true`, which `prepare` passes to `chooseRoute` (it returns the demo route) and which the runner's `chainMode` honours, so a waiting step runs as a demo even when Settings → Demo mode is Off. Dry-run rows use the feature `skill-check`, added to `HELPER_FEATURES` (`src/lib/library.ts`) so the Library hides them, and go to the Trash when the check ends. Passes when every step succeeds with outputs of its check's kind. Free, with or without keys. A tool step gets the plan check only in W1: its studio module would make a record the user sees (a demo dub session, a Layers project). W7 adds studio dry runs.
  3. `real` (optional, asks first with the price): run the examples for real, then `checkOutputs` with `probeMedia` (`src/lib/media-probe.ts`) for each checked step: kind, count, aspect, duration within ±10%, sound. A `look` sentence is judged only when an LLM that sees images is available (`llmText` with images, `src/server/enhance.ts`); a video gives one frame through the extract-frame model first. Never compare pixels or expect the same output.
  4. Write `verified[engine]`; `needsRecheck(recipe)` compares the catalog hash and runs `currentRequest` on each step.
- `load_skill` on a recipe skill appends `recipeMarkdown`, so Assist knows the skill can run by itself (W3 adds the tool).

**Storage.** No migration. Move `skills.files_json` from `ASSET_FREE` to `ASSET_REFS` (`{ table: "skills", cols: ["files_json"], what: "skill", key: "name", name: "title" }`) so a file a recipe names (an example, a fixed logo) survives Empty trash; update the `ASSET_REFS` paragraph of `docs/ARCHITECTURE.md`. New request fields `skill` and `demo` live in `request_json` and are stripped from API input like `chainFilled`.

**Export.** `GET /api/assist/skills/[name]/download?format=zip`: `SKILL.md` plus every bundled file (`src/server/zip.ts`), recipe examples and source stripped unless `&examples=1`. `importSkill` already reads `.zip`; a shared skill whose fixed media files were stripped asks for them as required inputs on first run.

**API.** `GET|PUT /api/assist/skills/[name]/recipe`; `POST /api/assist/skills/[name]/estimate`, `/run`, `/verify` (body: `values` or `rows` or `csv`, `engine`; verify: `level`). Same auth as the other `/api` routes.

**UI.**
- Skills page (`src/components/assist/skills-view.tsx`): a recipe skill's card gets a "Runs by itself" chip. In its dialog footer (the row with Download, Duplicate, Edit, Delete and the primary "Use in a new chat", about lines 294–330), the primary button becomes **Run…** (lucide `Play`), with "Use in a new chat" as a ghost button beside it. Under the description: "Checked 29 Oct · Cloud ✓ · GPU not checked", or in amber "Needs a re-check: Kling 3 was replaced by …" with **Re-check** (plan + demo). Download becomes a small menu: "SKILL.md" and "Skill with its files (.zip)" when there are files.
- New `src/components/assist/run-skill-dialog.tsx` (a Dialog, as the skill dialog is today, full height on phones): fields generated from params. Media use `MediaSlot` (`src/components/studio/media-slot.tsx`: upload or pick from the Library via `LibraryGrid`); text uses an input or textarea with the example as placeholder; number a stepper; choice a segmented control; element a list of saved elements (the same data `@` mentions use in `src/components/studio/prompt-input.tsx`). An engine switch (`src/components/studio/engine-switch.tsx`) only for engines whose plan passed. A live price line (debounced estimate) and a collapsible "What runs" list reusing the approval card's job rows (extract the job list of `ApprovalCard`, `src/components/assist/transcript.tsx`, into a shared `PlanJobs`). Tabs **One** | **Many**: Many takes pasted or uploaded CSV, shows a checked table with row errors inline, and the total. Run → toast "Started 20 runs" with "Open in Library".
- Deep link `/assist/skills?run=<name>`; the ⌘K palette (`src/components/command-palette.tsx`) lists "Run <skill title>…" for recipe skills.
- A skill without a recipe behaves as today.

**Tests.**
- `tests/recipe.test.ts`: schema and save-time problems; `fill` keeps types and interpolates text; required, default, min/max, options, element, media URL rules; `compile` gives `PipelineStep`s with `after`/`chain`, `batchTitle` and the `skill` stamp; count only on leaf steps; CSV (id or label headers, quotes, BOM, empty rows, 51 rows refused); `checkOutputs`; `stripExamples`.
- `tests/recipes.test.ts` (server, in the demo setup the other server tests use): a 3-step recipe makes one batch of 3 rows with the stamp; 3 CSV rows make 3 batches and one bad row starts nothing; a tool recipe (`add_captions`) runs through `executeTool` and opens its studio; `verify plan` per engine; `verify demo` passes with Demo mode **Off** and no keys, every row on the mock provider, nothing billed, rows hidden from the Library and trashed; `needsRecheck` after a `REPLACED_BY` move and after a model is switched off; built-in skills refused.
- `tests/library.test.ts` (`ASSET_REFS` describe): a file named only in a skill's `recipe.json` survives Empty trash; the coverage test passes.
- `tests/assist-skills.test.ts`: the zip export round-trips through `importSkill` with `recipe.json`; examples stripped by default; `load_skill` appends the Run it section.
- Browser, new `tests/e2e/skills-run.mjs` (demo mode): seed a recipe skill, run it once, run 3 CSV rows, Re-check; at 1440 and 390 px, light and dark. Add `/assist/skills?run=…` to `tests/e2e/_routes.mjs` so `no-horizontal-scroll.mjs` covers the dialog.

**Running elsewhere.** This package adds the Skills page form and its deep link. Assist and MCP come in W3 (`run_skill`), schedules and the CLI in W4, the Canvas in W5. Making a recipe from past work is W2; until it ships, a recipe can be written by hand and uploaded in a `.zip` with its `SKILL.md`.

**Demo mode.** Everything works in demo mode (prices shown as demo, runs on the mock provider). The dry-run check never bills, with or without keys.

### W2 · Make a skill from what you made (P0)

**Goal.** Turn results the user already likes into a skill, after the fact, with no recording step: the closest Fuobe equivalent of Work2Skill's induction, built from exact requests instead of screen evidence.

**User story.** "I pick the turntable I liked, or select the three results of a chain in the Library, and press Make a skill. Fuobe shows the steps behind it, asks which inputs should change next time, checks it for free and saves it."

**Entry points.**
- Result ⋯ menu: a new `OutputActionId` `"make-skill"`, label "Make a skill from this…", placement `"menu"` right after "Reuse settings" in `src/lib/output-actions.ts`, for succeeded generations; icon in `ACTION_ICONS` (`src/components/studio/result-actions.tsx`, lucide `BookmarkPlus`). It appears in the Library, the studio feeds and the viewer.
- Library bulk bar (`src/components/library-view.tsx`, the `BarButton` row at about lines 759–776): **Make a skill**, enabled when the selection holds succeeded results; its label hides below `sm` but the button stays on phones (not `max-sm:hidden`).
- A Library stack (one batch) has no ⋯ menu, but selecting it in selection mode selects every item in it (`AssetCard`'s `selected`, `library-view.tsx` about line 681), so the bulk bar's Make a skill covers a whole batch.

**Builder (`draftFromGenerations(ids)` in `src/server/recipes.ts`).**
1. Walk `depends_on` (one id or a JSON list) back from each picked result to its roots. The picked results are the leaves; unrelated picks become parallel steps.
2. **Lift expansions.** Change `createShotFilm`, `createKeyframeFilm`, `createExtendChain`, `createStillTo3d` and `createRelitClip` (`src/server/chains.ts`) to stamp the request as asked on the row they return first (new server-set `GenerationRequest.asked`). The builder replaces such an expansion with one step built from `asked`. Rows made before this change are refused with "This was made in steps from one request: open it, press Reuse settings, run it again, then make the skill". They are detected by a shared batch and the step labels in §6 (a heuristic).
3. **Refuse or lift shape-changing work.** Refuse a row with `request.frame`, a chain slot with `index`, or a helper feature (`isHelperFeature`). A studio feature maps to its tool when one exists: dub → `dub_video`, katana → `katana`, captions → `add_captions`, layers → `split_layers`, shorts restyle → `restyle_footage`, faceless → `faceless_episode`, ads → `create_ads`. Lifting means finding the studio record that names the generation (the `ASSET_REFS` tables, e.g. `dub_sessions.data_json`, `katana_jobs.data_json`; the same `instr` lookup as `assetRefSql`) and rebuilding the tool input from it. Ship the lifts whose record holds the tool's input directly (dub, katana and captions look easiest; a guess, check each record); every other studio says "Made in <Studio>: making a skill from it isn't supported yet". Studios with no tool (Cinema, Genjutsu, Remove object, Content Factory, Influencer, Character Swap Studio, Photodump…) say the same.
4. **Each remaining generation becomes a generate step:** `currentRequest` first (a retired model moves, and the review screen says so), then `unfilledRequest(request, deps)` to remove chain-filled inputs. Keep model, op, prompt, negative prompt, params, preset and its options, LoRAs, engine, mix and signature. Drop server-set fields (`chainFilled`, `chainSkipped`, `notice`, `title`, `batchTitle`, `step`, `skill`, `demo`, `asked`). `after` = its `depends_on` in order; `chain` = its `request.chain`, or `chainFrom` as `[{ slot: "images", position }]`.
5. **Candidate inputs.** Inputs that don't come from a step (uploads, Library picks, @element handles) become media or element candidates with the original as `example`; the same URL used by several steps is one candidate. Prompts become text candidates. `numOutputs` on leaf steps, aspect ratio, duration and resolution become optional candidates. **Every candidate starts Fixed**: a templated prompt can lose what made the result good (the paper's own over-parameterisation worry).
6. **Checks** are proposed from the leaf outputs: kind, count, aspect from width/height, and duration and sound from `probeMedia` of the stored file. `look` stays empty unless the naming pass writes one.
7. **Optional naming pass** (`llmText`, `src/server/enhance.ts`; Claude or Ollama; skipped when there's none): given the steps, the prompts and up to 4 leaf thumbnails (images only; a video's poster frame), it returns JSON with input names and labels, suggested `{{slots}}` in prompts ("a matte black desk lamp" → `{{product}}`), a title, description, when_to_use and a `SKILL.md` body. Its system prompt adapts Work2Skill's policy (MIT, credited in a comment): separate procedure from trace; generalise values without losing counts, order, relationships or selection rules; keep observable completion checks; never invent a success condition; prefer Fuobe's own tools. Malformed output is ignored. Every suggestion is shown as a diff and starts unticked. Without an LLM, the body is written from the recipe (steps, inputs, checks): deterministic, no tokens.

**Review screen** (new `src/components/skills/skill-builder.tsx`; a tall Dialog at 1440 px, a full-screen sheet at 390 px). Top or left: the steps as cards (model, operation, output thumbnail, "waits for …"). Right or below: **What changes next time**, each candidate with a Fixed | Varies toggle, label, type and required; prompts show suggested slots highlighted, accepted one by one. Then name, title and description (prefilled), **Check it** (W1 plan + demo) and **Save skill**, enabled once the plan check passes (the demo check finishes in the background and updates the badge). Saving uses `createSkill` + `saveRecipe`, then opens W1's Run dialog prefilled with the examples ("Try it with new inputs").

**API.** `POST /api/assist/skills/draft` `{ generations: string[] }` → `{ draft, refusals }`. Add `draft` to `RESERVED` in `src/server/skills.ts` (a skill called "draft" would be shadowed by the static route).

**Storage.** No migration (`asked` lives in `request_json`).

**Tests.** `tests/recipe-builder.test.ts`: a cut-out → edit → image-to-video chain gives 3 steps with `after`/`chain` and one image input; an upload used twice gives one input; chain-filled inputs are removed; a retired model moves with a note; a shot film with `asked` becomes one step and an old one is refused; a storyboard frame, a per-frame Mixed Media step and a helper step are refused with the studio's name; a dub result lifts to `dub_video` (if shipped); unrelated picks become parallel steps; the naming pass's JSON is validated and ignored when malformed; without an LLM the body is deterministic. `tests/library-pure.test.ts` (it already covers `outputActions`): "make-skill" placement and that it shows only for succeeded results. Browser `tests/e2e/skills-builder.mjs` (demo mode): make a 3-step chain in the composer, select it in the Library, Make a skill, switch one input to Varies, Check it, Save, run with a new input; 1440 and 390 px, light and dark, no horizontal scroll.

**Demo mode.** The builder works on demo rows; a skill made from demo results says "Made from demo results: check it on your engine before trusting it".

### W3 · Assist saves and runs skills (P1)

**Goal.** A chat that finally worked becomes a skill, and next time Assist (Claude, Ollama or the offline planner) fills its inputs and shows one priced card instead of planning from scratch. MCP clients get the same tool for free.

**User story.** "The chat made the dub-and-caption flow I wanted. I click Save as skill. Next week I type '/dub-and-caption' with a new clip, or just 'do the dub thing for this', and approve one card."

**Save this chat as a skill.**
- Entry: the Assist header, beside **Schedule** (`src/components/assist-view.tsx` about line 163; lucide `BookmarkPlus`, label hidden below `lg` like Schedule), shown when the chat has a gated call that ran; and the chat ⋯ menu (`src/components/assist/chat-menu.tsx`): "Save as skill…".
- `draftFromThread(threadId)`: read `assist_threads.messages_json` and pair each assistant `tool_use` with its `tool_result` by `tool_use_id`. Keep calls to gated tools (`generate`, `create_storyboard`, `katana`, the six studio tools) whose result isn't `is_error` and names started ids. This covers auto-run calls, which have no approval card. Drop declined calls, errors and calls whose generations all failed. When the same tool was called again for the same output kind with changes, keep the last (a heuristic).
- `after` inside one `generate` call already makes chains. Across calls, an input that equals an output URL of an earlier kept call is a step reference: generate → generate merges into one pipeline, mapping the field to a chain slot (`images` → images, `end_image` → endImage, `video` → video, `audio` → audio, `voice_audio` → voiceAudio, `background_audio` → audio2). A cross-call reference into or out of a studio tool is refused in this package ("Skills can't wait for a studio step yet", W7). `create_storyboard` stays one tool step. The user's attachments become media candidates; the user's words go to the naming pass.
- Then W2's review screen.

**`run_skill` tool** (new `src/server/assist/skill-tools.ts`, pushed in `src/server/assist/tools.ts` beside `CONTEXT_TOOLS` and `STUDIO_TOOLS`, line 543): input `{ name, values?, rows? (≤ 50), engine? }`; gated; `plan` = `estimateRecipe` (atomic for a pipeline); `title` = the skill's title; `place` = the studio for a tool step; `run` = `runRecipe`. Bad values come back as an error listing the inputs ("needs product (image) and name (text)"). Because it's gated and in `TOOLS`, MCP lists it and `estimate_job` prices it with no change to `src/server/mcp.ts` beyond bumping `SERVER_INFO.version` to 1.3.0 and one sentence in its instructions.
- Context: the skill index (`src/server/assist/context.ts`) marks recipe skills "(runs by itself: run_skill with product, name)". Assist's system prompt: when a saved skill with a recipe fits, call `run_skill` with values from the message and attachments instead of re-planning.
- Offline planner (`offline` in `src/server/assist/agent.ts`): when a loaded skill (`/name` or a project skill) has a recipe, fill its media inputs from the message's attachments by kind and order, its first text input from the words, the rest from defaults or examples, and emit `run_skill`; if a required input is missing, reply naming it. No LLM.

**Storage.** None.

**Tests.** `tests/assist-skill-tools.test.ts`: `draftFromThread` on a stored thread with an approved `generate` chain, a declined call, an auto-run call (no card) and a failed call; a cross-call merge; a cross-call studio reference refused; `run_skill` plan and run in demo mode; the offline planner turns "/lamp-turntable" plus an attachment into a `run_skill` card. `tests/mcp.test.ts`: `tools/list` has `run_skill`, `estimate_job`'s enum includes it, version 1.3.0. Browser (extend `tests/e2e/assist-flows.mjs`): save a chat as a skill, then `/skill` plus an attachment in a new chat → approval card → run; 1440 and 390 px, light and dark.

**Demo mode.** All of it works on the offline planner and the mock provider. Live Claude and Ollama behaviour stays unverified (STATUS line 204), and small local models follow tool instructions less reliably.

### W4 · Skills on a schedule and in the CLI (P1)

**Goal.** Run a fixed procedure on a timer or from a terminal, deterministically, with the same prices and caps.

**User story.** "Every Monday my 'weekly promo' skill runs on my newest upload with no LLM in the loop. A teammate runs it from the CLI with a CSV of 20 products."

**Schedules.**
- The schedule dialog (`src/components/assist/schedule-dialog.tsx`) gets **What to run: A request** (today) | **A skill**: a picker of recipe skills plus W1's form (one set of values). Each media input can be a fixed file or **Newest upload of this kind (when it runs)**, read at run time from the newest upload asset of that kind.
- A skill run is a chat like today, so ask-first cards, the auto-run cap (default $2), `last_thread_id` and summaries keep working. `startSchedule` (`src/server/assist/schedules.ts`) already takes a `model` override: pass a fixed `ModelCall` that returns one `run_skill` `tool_use` with the task's values, then an `end_turn` reply. No LLM is called.
- Deleting or renaming a skill pauses its tasks with the reason, as a deleted project does (extend `renameSkillRefs` in `src/server/skills.ts`).

**Storage.** One migration, the next entry in `MIGRATIONS` (`src/server/db.ts`; index 23 at `7d7a765`): `ALTER TABLE assist_schedules ADD COLUMN skill_json TEXT` holding `{ name, values, sources }`. Add `skill_json` to the `assist_schedules` entry of `ASSET_REFS` (values hold file URLs) and document the migration in `docs/ARCHITECTURE.md`.

**CLI** (`bin/lib/commands.mjs`, `bin/lib/skills.mjs`, `docs/cli.md`).
- `fuobe skills params <name>`: the inputs as text.
- `fuobe skills estimate <name> -p key=value… [--rows rows.csv] [--engine open|cloud]`.
- `fuobe skills run <name> -p key=value… [--rows rows.csv] [--engine …] [--wait] [--out dir] [--yes]`: local files in `-p` are uploaded first, as `generate --image` does (estimate uses the same stand-ins); it asks "Run 20 for $12.40? [y/N]" unless `--yes` or `--json`; `--wait` and `--out` reuse generate's wait and download path.
- `fuobe skills export <name> [--examples] [--out file.zip]`: W1's zip.

**MCP.** Nothing beyond W3.

**Tests.** `tests/assist-schedules.test.ts`: a skill task with ask-first makes a card with the recipe's price; auto within the cap runs and over it waits; "newest upload" resolves at run time; a deleted skill pauses its task; the migration adds the column on an old database; the `ASSET_REFS` coverage test passes. `tests/cli.test.ts` / `tests/cli-run.test.ts`: `-p` parsing, CSV, upload stand-ins, the confirmation, `--json`. Browser: the schedule dialog's skill mode at 1440 and 390 px, light and dark.

**Demo mode.** Scheduled skill runs work in demo mode on the mock provider.

### W5 · Skills as canvases (P2)

**Goal.** See and edit a skill's steps on the Canvas, and turn a canvas into a skill with a form, which makes canvases reachable from Assist, MCP, the CLI and schedules for the first time.

**User story.** "I open my skill as a canvas to swap a model visually, then save it back. Or I built a canvas and want my team to run it from a form."

**Converter** (pure, in `src/lib/catalog/canvas.ts`): `recipeToCanvas(recipe)` and `canvasToRecipe(graph, page)`. Inputs become input nodes (prompt/text, image, video, audio, element); steps become model nodes, with edges from chain slots. Canvas → recipe: unconnected input nodes become inputs (Fixed by default), model nodes become generate steps (their request as `describeNode` builds it), and concatenator and Table nodes compile the way `runCanvas` does (`concatRequest`, `rowRequest`); Table rows become the Many tab's rows (text inputs only, at most 50 × 8, `TABLE_LIMITS`). Only when every slot maps to a port (prompt, images, endImage, video, videos, audio, voice ↔ voiceAudio): recipes using `audio2`, `audios`, `model3d`, `mask`, or chains with `stem`, `index` or `position` open read-only with "This skill can't be drawn yet"; a tool step shows as one read-only "Studio step" note.

**UI.** The canvas list (`src/components/canvas/canvas-list.tsx`, tabs Mine | Templates at about line 212) gains **Skills**: recipe skills that can be drawn, each with "Open as canvas" (makes a new canvas). The canvas editor (`src/components/canvas/canvas-editor.tsx`) menu gets "Save as skill…", which opens W2's review screen with the canvas as source.

**Checks and running.** A canvas saved as a skill goes through W1's plan and demo checks before it saves. Once saved it runs from every W1, W3 and W4 entry point, so a canvas can now be run from Assist, MCP, the CLI and schedules.

**Storage.** None (`canvases.graph_json`).

**Tests.** `tests/canvas-recipe.test.ts`: recipe → canvas → recipe is equal for drawable recipes; each refusal; Table rows → rows. Browser: Skills tab and Save as skill at 1440 and 390 px, light and dark (extend `tests/e2e/canvas-smoke.mjs`).

**Demo mode.** Works as the Canvas does in demo mode.

### W6 · Fuobe suggests skills and keeps them working (P2)

**Goal.** Notice repeated work and offer to save it (AWM-style online induction), and keep saved skills healthy as the catalog changes.

**User story.** "Fuobe notices I've made the same 'cut-out, scene, upscale' chain four times this week and offers to save it. My skill tells me when a step starts failing and suggests a fix."

- **Suggestions.** A pure `shapeOf(dag)` (in `src/lib/recipe.ts`): the sorted model ids, ops and chain slots of a DAG from `request_json` and `depends_on`, ignoring prompts, inputs, helper features and `eval`. A sweep (when the Library opens, at most once a day, server side in `src/server/recipes.ts`) groups the last 14 days of DAGs by shape. When one shape appears 3 or more times and no saved recipe has it, the Library shows a card above the grid in the All view (`src/components/library-view.tsx`, under the filters; full width at 390 px): "You've made 'cut-out → scene → turntable' 4 times. Save it as a skill?" with **Make a skill** (W2 with the newest run's rows), **Not now** and **Don't suggest this**. Dismissed shapes live in a settings row `skills.suggestions` (JSON; no migration).
- **Run history** per skill from generations whose `request_json` `$.skill.name` matches (`json_extract`; no new table): runs, success rate, spend, last run and favourites. Shown as a **History** section in the skill dialog (`src/components/assist/skills-view.tsx`, under Files): the last 10 runs with status, cost, date and a link to the run's batch in the Library.
- **Fix suggestions.** A step that failed in 2 of the last 5 runs, was moved by `REPLACED_BY`, or was switched off in Models & licences gets **Suggest a fix** on the skill's "Needs a re-check" line: models with the same op and kind that are on (the `search_models` logic), with their prices. The user picks one; W1's plan and demo checks run; then it saves. Never swapped automatically.
- **Finding skills.** Past `SKILL_INDEX` (60), rank `list_skills` and the context index by word match, use count (from history) and recency, so the most used recipe skills are always in Assist's context.
- **Evaluation.** `pnpm eval:from-skill <name>` writes a `scripts/eval` case from the recipe's examples and checks, so the harness can regression-test a skill on a GPU or the cloud under its spend cap.
- **Storage.** None (a settings row and `request_json`).
- **Demo mode.** Suggestions and history work on demo rows; a suggestion built from demo rows says so.
- **Tests.** `tests/skill-suggest.test.ts`: the same chain with different prompts and inputs has one shape; helper and `eval` rows are ignored; the 3-in-14-days threshold; dismissal; no suggestion for a shape a saved recipe has. `tests/recipes.test.ts`: history from the `skill` stamp; fix candidates share op and kind and are switched on; ranking puts a used skill first. Browser: the suggestion card and the History section at 1440 and 390 px, light and dark, in demo mode.

### W7 · Skills that span studios (P2)

**Goal.** Let a studio step feed later steps, and a generate step feed a studio step ("dub, then captions, then a 9:16 cut"), which needs waiting across modules that `createPipeline` can't validate as one.

**User story.** "My 'Spanish short' skill dubs the clip, burns captions and cuts a 9:16 version. I start it once and each step starts by itself."

- **Format.** Recipe version 2 (version 1 files still load): `{{steps.<key>.output}}` (the step's first output of the kind the field takes) in a tool step's input or a generate step's input, and tool steps anywhere in the order. `recipeProblems` checks that every reference points at an earlier step of a kind that fits.
- **Builder.** W3's `draftFromThread` stops refusing cross-call references into and out of studio tools and writes them as step references.
- **Runner.** `runRecipe` creates a `skill_runs` row, starts every step whose inputs exist (generate DAG parts through `createPipeline`, tool steps through `executeTool`, keeping each `StudioRun`'s ids and `href`), and a sweep (like the scheduled tasks' 30 s sweep, started with the generation runner) starts each waiting step when the generations it needs succeed. A failure fails the steps after it and says which step and why. `createPipeline`'s `existing` option may link later generate steps to a studio's result ids directly (a guess; untested).
- **Checks.** Plan check per step, with stand-in files for step references. Studio dry runs: `src/server/demo-scope.ts` (`runAsDemo(fn)` and `inDemoScope()` on `AsyncLocalStorage`); `chooseRoute` returns the demo route inside the scope and rows created inside it get `request.demo`, so studio modules run as demos with no change to their code; the check then deletes the studio records it made (dub session, Layers project…).
- **Running** from every place W1, W3 and W4 added (Run dialog, `run_skill`, schedules, CLI): the result names the run and which steps wait; `run_skill`'s result says so to the agent.
- **UI.** The Run toast links to the run's progress, shown in the skill dialog's History (W6): "Dub · done → Captions · running → 9:16 cut · waiting", each with "Open in <Studio>" when the studio gave a page.
- **Storage.** One migration (the next `MIGRATIONS` entry): `skill_runs` (id, skill, values_json, state_json with each step's status, generation ids and studio href, created_at, updated_at), with `values_json` and `state_json` in `ASSET_REFS`; documented in `docs/ARCHITECTURE.md`.
- **Demo mode.** The whole chain runs on the mock provider.
- **Tests.** `tests/skill-runs.test.ts`: a dub → captions → reframe recipe in demo mode starts the dub, waits, then starts the rest; a failed dub fails the rest with its reason; state survives a restart (reloaded from `skill_runs`); the studio dry run deletes its records. Browser: the run's progress in the skill dialog at 1440 and 390 px, light and dark.

### Not planned

A screen or desktop recorder (WorkRecorder-style) would duplicate Claude "Record a skill", OpenAI Record & Replay and Microsoft Skill Recorder and add nothing for Fuobe's own actions. A "Record" toggle that stamps a session id on new generations is a possible later shortcut, only if users ask after W2 ships.

## 11. Risks

- **Marketing numbers aren't product evidence.** +25 pp is one model's full-credit SR on its own demonstrated tasks in mock apps, scored by an unnamed LLM judge; it falls to +9.4 pp on changed versions. Don't quote it in Fuobe copy.
- **Evaluation integrity.** The OSWorld subset dropped 35 of 321 tasks where skills hurt GPT-5.5 (dataset card, project page); the paper describes a different screening. Don't cite any OSWorld number from the paper.
- **Nothing reproducible.** No repeated runs or variance; no released skills, runners, judge or results.
- **Generative outputs vary.** Providers and seeds differ and some APIs ignore seeds. Checks must be structural plus an optional vision judgement, never output equality. Users may expect "the same result" from a replay; say "same steps, new take".
- **Free checks aren't free today.** Demo mode is global, so a dry run with keys connected would run, and bill, for real until W1's per-run `demo` flag exists.
- **`look` sees images only.** Video and audio checks are structural (`probeMedia`) or use an extracted frame.
- **Shape-changing pipelines** (Mixed Media per frame, storyboards, shot and keyframe films, Faceless scenes) are wrong if replayed as a frozen expanded graph. Lift them to the request as asked or the studio call, or refuse.
- **Studio tools run outside `createPipeline`.** A recipe that feeds a studio's output into later steps can't be validated atomically and needs W7's orchestrator.
- **Coverage.** About 13 to 15 studio areas have no Assist or MCP tool (our count from `src/app/api` folder names); their results can't become skills until they do.
- **Catalog drift.** Retired models, price changes and Models & licences switches can break or reprice a saved skill; "needs a re-check" is required. Engine portability is limited where no open route exists, and a cloud route is offered only where the model is actually hosted.
- **Spending without a person watching.** `run_skill` from schedules, MCP and the CLI spends money or GPU time. Keep the approval card, estimate first and per-run caps. A CSV batch multiplies cost: price the whole batch before starting.
- **Sharing loses recipes today.** The download route returns `SKILL.md` only; until W1's zip ships, a shared skill silently loses `recipe.json`.
- **File lifetime.** `skills.files_json` is in `ASSET_FREE` today; a recipe that names a file needs it in `ASSET_REFS`, or Empty trash deletes the file.
- **Privacy.** Recipes keep upload URLs, faces, voices and prompts with names. Exports strip examples by default. WorkDemo-350 itself ships raw keylogs with password-related text and no consent records: a warning, not a model.
- **Imported recipes.** A third-party skill with a `recipe.json` can start paid jobs, and its `SKILL.md` can carry prompt injection. Validate with zod, allow only catalog models and Assist tools, read remote inputs only through `remote-fetch.ts`, and ask before the first run of an imported recipe.
- **Over- or under-parameterising.** The naming pass can make a prompt generic and lose what made the result good. Keep Fixed as the default and show a diff against the original prompt.
- **Assist is untested live** (STATUS line 204): "Save this chat as a skill" and Assist choosing `run_skill` need live-model testing; small local models follow tool instructions less reliably.
- **Scale.** The context index stops at 60 skills and `list_skills` matches words; a large library needs W6's ranking.
- **Scope creep.** A screen recorder adds nothing for Fuobe's own actions.

## Sources (read 2026-10-29)

- Project page: https://china-qijizhifeng.github.io/Work2Skill/ (raw HTML saved at `/tmp/claude-0/-home-user-Fuobe/221b9f5b-3545-5877-b8bb-611025cc772b/scratchpad/w2s-page/index.html`; the "post hoc OSWorld selection" sentence; no +25 pp figure)
- Paper: https://arxiv.org/abs/2610.12984 (v1, 9 Oct 2026) and https://arxiv.org/pdf/2610.12984, read locally at `/home/user/ext/work2skill-paper/paper.txt`: Sec. 3.2 and App. E (task screening), Sec. 3.3 ("Candidate skills are not executed during induction"; the checks "do not verify skill correctness or task success"), Tables 1–3, Figs. 4–5, App. E.4 (baseline adaptation); no limitations section; AWM not in the references
- Dataset: https://huggingface.co/datasets/yuqi777/WorkDemo-350 (card saved at `/tmp/claude-0/-home-user-Fuobe/221b9f5b-3545-5877-b8bb-611025cc772b/scratchpad/w2s-hf/README.md`) and https://huggingface.co/api/datasets/yuqi777/WorkDemo-350?blobs=true
- Repository: https://github.com/china-qijizhifeng/Work2Skill (GitHub page via WebFetch; the GitHub API wasn't enabled for this session); clone `/home/user/ext/Work2Skill` @ `f2ecdc9992749952864d05fb864d670b782dee0a`: `README.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, `AgenticSkillInduction/{README.md, agent.yaml, system_prompt.md, start.py, bindings.py L658–855, skills/skill-creator/SKILL.md, tests/test_bindings.py}`, `DownstreamTasks/{README.md, tasks-jitter.json, selected_task_ids.json}`; issues https://github.com/china-qijizhifeng/Work2Skill/issues/1 and /2
- MyPCBench: https://github.com/ljang0/MyPCBench (README: 17 mock web apps, generated data, offline LLM judge with Gemini 3.1 flash-lite preview as default) and https://raw.githubusercontent.com/ljang0/MyPCBench/main/tasks/final/task_types.json (64 of 184 tasks are bounded_action)
- Third-party write-up: https://explainx.ai/blog/work2skill-human-gui-demonstrations-reusable-agent-skills-paper-2026 (2026-10-12; "We have not run the released code ourselves"; no +25 figure)
- Related work: https://arxiv.org/abs/2409.07429 (Agent Workflow Memory), https://arxiv.org/abs/2504.06821 (ASI)
- Products: https://support.claude.com/en/articles/12512198-how-to-create-custom-skills (Record a skill), https://learn.chatgpt.com/docs/extend/record-and-replay (Record & Replay), https://github.com/microsoft/skill-recorder and https://www.everydev.ai/tools/skill-recorder/llms.txt (Skill Recorder)
- Fuobe @ `7d7a765`: `skills/README.md`, `skills/product-photoshoot/SKILL.md`, `tests/skills-spec.test.ts`, `src/server/skills.ts`, `src/app/api/assist/skills/[name]/download/route.ts`, `src/lib/assist.ts`, `src/server/assist/{tools.ts, define.ts, studio-tools.ts, studio-routes.ts, context.ts, context-tools.ts, agent.ts, schedules.ts}`, `src/lib/assist-schedule.ts`, `src/server/mcp.ts`, `bin/lib/{commands.mjs, skills.mjs}`, `src/server/chains.ts`, `src/server/generations.ts` (`ASSET_REFS`, `ASSET_FREE`, `chooseRoute`, `currentRequest`, `previewChained`, `createGenerations`, `unfilledRequest`, `chainMode`), `src/server/settings.ts`, `src/server/enhance.ts` (`llmText`), `src/server/storage.ts`, `src/server/remote-fetch.ts`, `src/server/db.ts`, `src/lib/catalog/{types.ts, canvas.ts, replaced.ts}`, `src/lib/library.ts`, `src/lib/media-probe.ts`, `src/lib/output-actions.ts`, `src/components/{library-view.tsx, assist-view.tsx, command-palette.tsx}`, `src/components/studio/{result-actions.tsx, media-slot.tsx, engine-switch.tsx, feed.tsx}`, `src/components/assist/{skills-view.tsx, chat-menu.tsx, schedule-dialog.tsx, transcript.tsx}`, `src/components/canvas/{canvas-list.tsx, canvas-editor.tsx}`, `scripts/eval/README.md`, `docs/STATUS.md` (lines 165–172, 200–205), `docs/ARCHITECTURE.md` (migrations, `ASSET_REFS`)
