---
name: localization
description: Localise videos, voice-overs, captions and scripts into other languages — dub a video in the speaker's own voice with lip sync, translate subtitles with their timing, or translate ad copy and in-image text.
compatibility: Needs a Fuobe server. Fuobe Assist runs these steps itself; other agents call the same tools on Fuobe's MCP endpoint (/api/mcp) or use the fuobe CLI.
metadata:
  title: Translate & Dub
  when_to_use: The user wants a video dubbed, "the same video in Spanish", translated subtitles, a voice-over in another language, or copy translated for another market.
  icon: languages
  studio: /audio
  tags: dub, translate, localization, captions
  offline_kind: text
---

# Translate & Dub

## Dub a video (speech in, speech out)
Prefer the **`dub_video` tool**: pass the video and the target language(s). It separates the
voice from the background, transcribes, translates with timing, re-voices in the speaker's own
voice, optionally lip-syncs, and mixes the new voice over the original background.
Without it, chain `generate` steps with `after`:
1. op `separate-audio` (`demucs` / `oss-voice-separate`) → voice and background stems
2. op `transcribe` on the voice (`scribe-v2` / `oss-qwen3-asr`)
3. op `translate` (`text-llm` / `oss-text-llm`) with `target_language` — cues keep their timing
4. op `tts` cloning the voice stem (`chatterbox-cloud` / `oss-chatterbox`)
5. op `lipsync` (`sync-lipsync-3` / `oss-infinitetalk-v2v`) — skip for voice-over-only footage
6. op `mux` with the new voice and `background_audio` = the background stem (open source).
Cloud one-shot alternative: `heygen-translate` (op `dub`).

## Subtitles only
op `transcribe` → op `translate` (cues keep their timing) → the `add_captions` tool, or deliver the
.srt (text output) for the user's own editor.

## Copy and in-image text
Translate yourself (or op `translate`) — adapt idioms, keep brand names, units and prices local
("$" → "€" only if the user says so). For text inside images, load image-repurposer.

## Quality
Name the languages up front; one job per language. Flag lines that ran long after translation
(German and French run ~20% longer) — the dub may speed up there. Offer a native-speaker review
note when the content is legal or medical.

## Using Fuobe from an agent
Outside Fuobe Assist (Claude Code, Codex, Cursor…), connect Fuobe's MCP server (`fuobe mcp` prints
the command) and call the same tools: `dub_video` for a dub (price it with `estimate_job`),
`generate` for the transcribe → translate chain, and `add_captions` for subtitles. Price a run with
`estimate_cost` (or `estimate_job` for a studio tool) and confirm it with the user first. Files go
in as URLs: `fuobe upload <file>` prints one. Without MCP, the `fuobe` CLI runs the same jobs
(`fuobe generate`, `fuobe tool <name>`).
