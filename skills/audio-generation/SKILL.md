---
name: audio-generation
description: Guides audio jobs — voice-overs, dialogue between voices, music tracks and beds, sound effects, sound for a silent video, voice changing and voice cloning — picking the right model and writing prompts that each kind of model understands.
compatibility: Needs a Fuobe server. Fuobe Assist runs these steps itself; other agents call the same tools on Fuobe's MCP endpoint (/api/mcp) or use the fuobe CLI.
metadata:
  title: Audio Generation
  when_to_use: The user wants any audio — "a voice-over", "a jingle", "background music", "a whoosh sound", "add sound to this video", "make this sound like me", "a conversation between two characters".
  icon: audio-lines
  studio: /audio
  tags: audio, music, sfx, voice
  offline_kind: audio
---

# Audio Generation

| Want | Op | Cloud | Open source |
|---|---|---|---|
| Speech | `tts` | `elevenlabs-v4`, `minimax-speech-2-8`, `inworld-tts` | `oss-chatterbox`, `oss-indextts2` |
| Two+ speakers | `dialogue` | `elevenlabs-dialogue` | `oss-chatterbox-dialogue` |
| Music | `music` | `sonilo-music`, `lyria-3-pro`, `minimax-music-2-5` (songs with lyrics), `elevenlabs-music` | `oss-ace-step` |
| Sound effects | `sfx` | `mirelo-sfx-2`, `stable-audio-3-sfx`, `elevenlabs-sfx` | `oss-stable-audio-3`, `oss-mmaudio-sfx` |
| Sound for a video | `v2a` | `mirelo-sfx-2-video`, `mmaudio-cloud` | `oss-mmaudio` |
| Change a voice | `voice-change` | `elevenlabs-voice-changer` | `oss-chatterbox-vc` |
| Split voice/music | `separate-audio` | `demucs` | `oss-voice-separate` |
Check `search_models` with kind `audio` when the user names a model or a voice.

## Prompting each kind
- **Speech**: the exact words only; emotion via punctuation and short sentences. Pass `voice`
  (a voice id from search_models) or `voice_audio` (a recording to clone).
- **Music**: genre, tempo in BPM, mood, instruments, structure, length, and "instrumental" when no
  vocals: "lo-fi hip hop, 80 bpm, warm Rhodes, vinyl crackle, mellow, 60 seconds, instrumental".
  For songs, put lyrics in the prompt with [verse]/[chorus] tags on models that take lyrics.
- **SFX**: one sound, physical words, duration: "heavy wooden door slowly creaking open, then a
  dull thud, 3 seconds, dry room".
- **Video to audio**: the video in `video`; describe what should be heard, not what's seen.

## Delivery
Durations: set `duration` when the model lists them. Offer 2 takes for music. To put audio on a
video use op `mux` (and `background_audio` to keep the original sound under it).

## Using Fuobe from an agent
Outside Fuobe Assist (Claude Code, Codex, Cursor…), connect Fuobe's MCP server (`fuobe mcp` prints
the command) and call the same tools: `search_models` with kind `audio` to pick the model and voice,
then `generate`; `check_generations` returns the audio's URL. Price a run with `estimate_cost` (or
`estimate_job` for a studio tool) and confirm it with the user first. Files go in as URLs:
`fuobe upload <file>` prints one. Without MCP, the `fuobe` CLI runs the same jobs (`fuobe generate`,
`fuobe tool <name>`).
