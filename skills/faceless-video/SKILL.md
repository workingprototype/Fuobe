---
name: faceless-video
description: Finished narrated, illustrated videos — explainers, channel episodes, history and documentary pieces, stories, narrated picture stories and kids songs — with a narrator over stylised scenes, one-off or recurring.
compatibility: Needs a Fuobe server. Fuobe Assist runs these steps itself; other agents call the same tools on Fuobe's MCP endpoint (/api/mcp) or use the fuobe CLI.
metadata:
  title: Faceless Studio
  when_to_use: The user asks for a faceless video, a YouTube/TikTok episode with narration over illustrations, an explainer, a documentary-style piece, a narrated story or a kids video. Not for script-only requests (use youtube-script) or a photo presenter on screen (use narration).
  icon: book-open
  studio: /faceless
  tags: faceless, explainer, narration, youtube
  offline_kind: video
  offline_aspect: "9:16"
  offline_style: "consistent illustrated style, clean shapes, soft cinematic lighting, gentle camera motion"
---

# Faceless Studio

A faceless video = a script read by a narrator over a sequence of scenes in one visual style.

## 1. Brief (ask at most one question)
Topic, length (default 60 s), format (9:16 for Shorts/TikTok/Reels, 16:9 for YouTube), style,
narrator voice (calm, energetic, warm), audience (adults / kids).

Faceless Studio's 12 styles (pass the id as `style_id`): `editorial-motion-graphics`
(cutouts, labels, diagrams, documentary pacing), `stickman-cartoon`, `watercolor-chronicle`,
`fairy-tale-myth`, `paper-diorama`, `pastel-flat-2d`, `colorful-3d` (toy-like 3D),
`hand-drawn` (storybook sketches), `poster-vector`, `mannequin`, `paper-collage`, `studio-3d`.
The Explainer's other styles work too: `whiteboard-doodle`, `3d-papercraft`, `mixed-media`,
`low-poly`, `2d-illustrator`, `pixel-art`, `claymotion`, `isometric-flat-vector`, `3d-mix`,
`fluffy-toy`.

## 2. Script and scenes
Write the narration first (~150 words per minute), then split it into scenes of roughly 8–10
seconds: each scene = its narration lines + one visual description in the chosen style. Keep a
recurring character or mascot identical across scenes (describe it the same way every time, or
use an `@element`). Show the scene list before generating.

## 3. Produce
- Prefer the **`faceless_episode` tool**: pass the scenes, `style_id` (and your style words),
  aspect and voice. One approval opens the episode in Faceless Studio (on an "Assist" channel):
  the stills and the narration first, then each scene animated and cut to where its lines are
  spoken, a music bed and subtitles. The user can change any scene there. Tell them it's there.
- Square (1:1) episodes, or a look none of the styles fits, run as plain steps in the Library.
- Without the tool, build the chain with `generate`: one still per scene (op `t2i`), one clip per
  still (op `i2v`, `after` the still, a slow push-in or pan), the narration (op `tts`), then join
  the clips (op `concat`) and mux the narration over them (op `mux`).
- Models: stills cloud `nano-banana-pro` / `seedream-5-pro`, open `oss-z-image-turbo`; clips
  cloud `gemini-omni-flash` or `seedance-2-5` (5 s), open `oss-wan22-14b-fast`; voice
  `elevenlabs-v4` / `oss-chatterbox`.
- "Frame by frame" (cheaper): skip the clips and ask for a slow Ken Burns move on each still.

## 4. Finish
Faceless Studio already adds a music bed and subtitles. Offer changes to a scene (in the studio), and a thumbnail
(load thumbnail-generation). For a recurring series, suggest saving the style and voice with
`remember` so the next episode matches.

## Using Fuobe from an agent
Outside Fuobe Assist (Claude Code, Codex, Cursor…), connect Fuobe's MCP server (`fuobe mcp` prints
the command) and call the same tools: `faceless_episode` (price it with `estimate_job`), or the
`generate` chain above. Price a run with `estimate_cost` (or `estimate_job` for a studio tool) and
confirm it with the user first. Files go in as URLs: `fuobe upload <file>` prints one. Without MCP,
the `fuobe` CLI runs the same jobs (`fuobe generate`, `fuobe tool <name>`).
