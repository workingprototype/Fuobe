---
name: short-film
title: Cinematic Director
description: A photoreal multi-clip short film or scripted scene driven by story, character, dialogue and mood — consistent characters across shots, a shot list, then the clips joined into one film.
when_to_use: The result is 2+ clips, several scenes, or a single video over 15 seconds with recurring characters — even when the user already wrote a shot list, and for "stitch them into one" briefs. Not for social creator formats (ugc-video) or motion graphics (visual-studio).
icon: clapperboard
studio: /cinema
tags: [film, story, video, cinematic]
offline:
  kind: video
  aspect: "16:9"
  style: "cinematic, anamorphic 35mm film look, motivated lighting, shallow depth of field, film grain"
---

# Cinematic Director

Think like a director: story first, then coverage, then the look. Keep characters and wardrobe
identical in every shot.

## 1. Development (in the chat, before any generation)
- Logline in one sentence. Ask at most one question if the genre or ending is unclear.
- A shot list of 3–8 shots: for each, the shot size (wide / medium / close-up / insert), the
  action, the camera move (push-in, dolly, crane, handheld, static), and any spoken line.
- The look: era, palette (2–3 colours), light (golden hour, neon night, overcast), lens (anamorphic
  40mm, 85mm portrait), grain.
Show the shot list compactly, then go — the approval card is the user's checkpoint.

## 2. Consistency
- Characters: if the user has saved characters, use their `@handle` (`list_elements`). Otherwise
  make a character sheet first (load the character-sheet skill) or one hero still per character.
- Make the first frame of every shot as a still that reuses the character still as a reference
  (`images`), then animate it. `create_storyboard` does exactly this for up to 8 frames — use it
  for the stills, then animate each frame.

## 3. Shots
- Cloud: `seedance-2-5` (default; 5–12 s, native audio, multi-shot), `kling-3` for strong motion,
  `veo-3-1` for dialogue with lip sync, `cinema-studio-4` for Higgsfield's camera controls.
- Open source: `oss-wan22-14b-fast` (i2v), `oss-wan22-14b` for quality.
- One `generate` job per shot with op `i2v`, `after` pointing at that shot's still. Write the
  prompt as action in time order, then camera, then light: "She turns from the window as the
  rain starts; slow push-in from medium to close-up; cold blue moonlight, warm practical lamp".
- For one continuous clip with cuts, a model with multi-shot can take `shots` instead.

## 4. Assembly and sound
Join the clips in order (op `concat`: cloud `join-clips`, open `oss-join-clips`, `after` each
clip). Add a score (op `music`: `sonilo-music` / `oss-ace-step`) and mux it (op `mux`). Offer a
dialogue pass with lipsync for lines that need it.

## 5. Review
`check_generations` with `look: true` on the stills before animating when the brief is
demanding. Name the weakest shot and offer to redo it.
