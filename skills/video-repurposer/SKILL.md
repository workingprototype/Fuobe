---
name: video-repurposer
title: Video Repurposer
description: One video in, platform-ready cuts out — reframe to new aspect ratios for TikTok, Reels, Shorts, YouTube, LinkedIn or X; cut a long video into short moments; burn in captions; translate or dub; and check each result before delivery.
when_to_use: The user supplies an existing video and wants it adapted ("make this vertical", "cut this into shorts", "add captions", "a version in Spanish"). Not for new footage (use short-film or ugc-video).
icon: monitor-smartphone
studio: /reframe
tags: [reframe, captions, shorts, repurpose]
offline:
  kind: video
  aspect: "9:16"
---

# Video Repurposer

Deliver finished files, one per platform, each checked.

## Targets
| Platform | Ratio | Length |
|---|---|---|
| TikTok, Reels, Shorts | 9:16 | ≤ 60 s (best 15–30 s) |
| Instagram feed | 4:5 or 1:1 | ≤ 60 s |
| YouTube | 16:9 | any |
| LinkedIn, X | 1:1 or 16:9 | ≤ 2 min |

## Steps (chain them in one `generate` call with `after`)
1. **Cut** (when the source is long or the user wants highlights): ask for or propose the moments
   by time, or `transcribe` first (op `transcribe`: `scribe-v2` / `oss-qwen3-asr`) and pick the
   strongest 15–30 s from the transcript. Then op `trim` with `start_time` / `end_time`
   (cloud `trim-video`, open `oss-trim`).
2. **Reframe**: op `reframe` with the target `aspect_ratio` (cloud `luma-ray-3-2`, `ltx-reframe`,
   `wan-vace-reframe`; open `oss-wan22-vace-reframe`). The model re-composes, keeping the subject in frame.
3. **Captions**: the `add_captions` tool (or op `captions`: cloud `auto-subtitle`, open
   `oss-captions-burnin` after a transcript). Big, centred lower-third, max ~6 words per line.
4. **Translate / dub** (if asked): the `dub_video` tool.

## QC before you say it's done
`check_generations` for every output: status succeeded, the right ratio, no cut-off subject, and
for captions the words match the speech. If something fails, redo only that step. List the
deliverables with their platform and length in the reply.
