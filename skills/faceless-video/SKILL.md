---
name: faceless-video
description: Finished narrated, illustrated videos — explainers, channel episodes, history and documentary pieces, stories, narrated picture stories and kids songs — with a narrator over stylised scenes, one-off or recurring.
compatibility: Needs a Fuobe server. Fuobe Assist runs these steps itself; other agents call the same tools on Fuobe's MCP endpoint (/api/mcp) or use the fuobe CLI.
metadata:
  title: Faceless Studio
  when_to_use: The user asks for a faceless video, a YouTube/TikTok episode with narration over illustrations, an explainer, a documentary-style piece, a narrated story or a kids video. Not for script-only requests (use youtube-script) or a photo presenter on screen (use narration).
  icon: book-open
  studio: /storyboard
  tags: faceless, explainer, narration, youtube
  offline_kind: video
  offline_aspect: "9:16"
  offline_style: "consistent illustrated style, clean shapes, soft cinematic lighting, gentle camera motion"
---

# Faceless Studio

A faceless video = a script read by a narrator over a sequence of scenes in one visual style.

## 1. Brief (ask at most one question)
Topic, length (default 60 s), format (9:16 for Shorts/TikTok/Reels, 16:9 for YouTube), style
(e.g. "flat 2D illustration", "watercolour storybook", "3D clay", "dark documentary photo
collage", "anime"), narrator voice (calm, energetic, warm), audience (adults / kids).

## 2. Script and scenes
Write the narration first (~150 words per minute), then split it into scenes of roughly 8–10
seconds: each scene = its narration lines + one visual description in the chosen style. Keep a
recurring character or mascot identical across scenes (describe it the same way every time, or
use an `@element`). Show the scene list before generating.

## 3. Produce
- Prefer the **`faceless_episode` tool**: pass the scenes, style, aspect and voice; it plans the
  stills, the animated clips, the narration and the final join in one approval.
- Without it, build the chain with `generate`: one still per scene (op `t2i`), one clip per
  still (op `i2v`, `after` the still, a slow push-in or pan), the narration (op `tts`), then join
  the clips (op `concat`) and mux the narration over them (op `mux`).
- Models: stills cloud `nano-banana-pro` / `seedream-5-pro`, open `oss-z-image-turbo`; clips
  cloud `gemini-omni-flash` or `seedance-2-5` (5 s), open `oss-wan22-14b-fast`; voice
  `elevenlabs-v4` / `oss-chatterbox`.
- "Frame by frame" (cheaper): skip the clips and ask for a slow Ken Burns move on each still.

## 4. Finish
Offer captions (`add_captions`), a music bed (op `music`, low under the voice), and a thumbnail
(load thumbnail-generation). For a recurring series, suggest saving the style and voice with
`remember` so the next episode matches.

## Using Fuobe from an agent
Outside Fuobe Assist (Claude Code, Codex, Cursor…), connect Fuobe's MCP server (`fuobe mcp` prints
the command) and call the same tools: `faceless_episode` (price it with `estimate_job`), or the
`generate` chain above. Price a run with `estimate_cost` (or `estimate_job` for a studio tool) and
confirm it with the user first. Files go in as URLs: `fuobe upload <file>` prints one. Without MCP,
the `fuobe` CLI runs the same jobs (`fuobe generate`, `fuobe tool <name>`).
