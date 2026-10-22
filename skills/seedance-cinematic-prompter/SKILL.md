---
name: seedance-cinematic-prompter
description: Decide the scene, then write a production-safe Seedance 2.5 prompt — subject, action in time order, camera, lens, light, mood, sound — and pick duration, resolution and references so the clip comes out right the first time.
compatibility: Needs a Fuobe server. Fuobe Assist runs these steps itself; other agents call the same tools on Fuobe's MCP endpoint (/api/mcp) or use the fuobe CLI.
metadata:
  title: Seedance Cinematic Prompter
  when_to_use: The user wants a single cinematic video clip on Seedance (or names Seedance), asks for help writing a video prompt, or a previous Seedance take came out wrong.
  icon: camera
  studio: /video
  tags: seedance, video, prompting
  offline_kind: video
  offline_aspect: "16:9"
  offline_style: "cinematic, 35mm anamorphic, shallow depth of field, motivated practical lighting, subtle film grain, smooth deliberate camera move"
---

# Seedance Cinematic Prompter (CINEDANCE)

Seedance 2.5 (`seedance-2-5`) follows time-ordered direction well, renders native audio, takes up
to 10 reference images/videos (op `ref2v`), and runs 4–12 s (30 s in some tiers).

## CINEDANCE — the order of a good prompt
1. **C**haracter — who, wearing what, one distinctive detail (or `@handle`).
2. **I**ntention — what they want in this moment.
3. **N**arrative action — what happens, in order: "first…, then…, finally…". One clear action per 3–4 s.
4. **E**nvironment — place, time of day, weather, props.
5. **D**irection — camera move and framing over time: "starts wide, slow dolly-in to a close-up".
6. **A**tmosphere — light (key direction, colour temperature, practicals), palette, mood.
7. **N**oise — the sound: ambience, effects, a short line of dialogue in quotes.
8. **C**raft — lens and film look: "40mm anamorphic, shallow depth of field, light grain".
9. **E**xclusions — via `negative_prompt`: "no text, no watermark, no extra people".

## Settings
- Duration: 5 s for one action, 8–10 s for two beats; don't pack 3+ actions into 5 s.
- `aspect_ratio` 16:9 cinematic, 9:16 social, 21:9 for scope.
- Start frame: if the user has a still, op `i2v` with it in `images` — the most reliable way to
  lock the look. With several references, op `ref2v`.
- `generate_audio: true` when sound matters.
- For multiple angles of one scene in one clip, `shots` (2–6).

## Production safety
Avoid real public figures, brand logos you don't own, and graphic violence — rephrase to the
intent. Name the most likely failure (fast hands, crowd faces, text on signs) and simplify it.

Show the final prompt in a short block, then call `generate`.

## Using Fuobe from an agent
Outside Fuobe Assist (Claude Code, Codex, Cursor…), connect Fuobe's MCP server (`fuobe mcp` prints
the command) and call the same tools: `generate` with model `seedance-2-5` (`oss-wan22-14b` on the
open engine). Price a run with `estimate_cost` (or `estimate_job` for a studio tool) and confirm it
with the user first. Files go in as URLs: `fuobe upload <file>` prints one. Without MCP, the `fuobe`
CLI runs the same jobs (`fuobe generate`, `fuobe tool <name>`).
