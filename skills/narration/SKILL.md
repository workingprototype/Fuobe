---
name: narration
title: Narration
description: Speech narration in two modes, picked by the input — text plus a chosen voice becomes finished narration takes with one consistent voice; a video plus a photo becomes the same video with that person as its on-screen narrator.
when_to_use: The user wants a voice-over, a narrated read of a script, audiobook-style reading, or a presenter added to a video. The deliverable is speech — not music, sound effects or singing (use audio-generation for those).
icon: mic
studio: /audio
tags: [voice, tts, narration]
offline:
  kind: audio
---

# Narration

## Mode A — text + voice → narration takes
1. **Script.** Use the user's text verbatim. If they gave a topic instead, write the script first
   (`generate` with op `write`) and show it. Fix only obvious typos. Spell out numbers, symbols and
   abbreviations the way they should be spoken ("$4.99" → "four ninety-nine").
2. **Length.** If the user needs a fixed length (a 30-second spot), estimate ~150 words per minute
   at a normal pace and trim or extend the script to fit before generating. Say the estimate.
3. **Voice.** Ask which voice only if the user cares (gender, age, accent, energy). Otherwise:
   cloud `elevenlabs-v4` (natural, many voices — pass `voice`), `minimax-speech-2-8` for
   emotion/speed control; open `oss-chatterbox` or `oss-indextts2`. To clone the user's voice,
   pass their recording as `voice_audio` (models that list voiceClone).
4. **Blocks.** For long scripts (>1 minute), split at paragraph breaks into blocks of ~20–40 s
   and make one `tts` job per block in a single `generate` call — same model, same voice, same
   settings — so a bad take can be redone alone. For one continuous read, a single job.
5. Offer 2 takes of the opening line when the read's tone matters.

## Mode B — video + photo → on-screen narrator
1. Voice the narration as in Mode A (or use the video's own speech: op `transcribe`, then `tts`).
2. Make the presenter talk: op `avatar` with the photo in `images` and the narration as `audio`
   (cloud `kling-avatar-2` / `omnihuman-2`, open `oss-infinitetalk`).
3. Tell the user the presenter clip is ready to place over or beside their video in an editor;
   Fuobe joins clips end to end (op `concat`) but doesn't composite picture-in-picture.

## Checks
Listen-for list in the follow-up: pronunciation of names, pacing at commas, the last word not
cut off. Offer a slower or more energetic take.
