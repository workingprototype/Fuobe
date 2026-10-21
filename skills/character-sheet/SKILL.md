---
name: character-sheet
title: Character Sheet
description: Cast a character, lock the wardrobe, and get a verified multi-view reference sheet (front, back, side, portrait) to reuse for recurring characters across images and videos.
when_to_use: The user needs a consistent character for a series, a film, an ad campaign or a mascot; asks for a "character sheet", "turnaround", "model sheet" or "reference sheet"; or a story needs the same person in many shots.
icon: user-square
studio: /elements
tags: [character, consistency, reference]
offline:
  kind: image
  aspect: "16:9"
  outputs: 2
  style: "character reference sheet on a plain light-grey background: full-body front view, back view, side view and a head-and-shoulders portrait, identical face, hair and outfit in every view, even studio lighting, clean labels"
---

# Character Sheet

## 1. Casting
- From a photo (the user's or an `@element`): the sheet must keep that face — op `edit` with the
  photo in `images`.
- From a brief: write the character in one paragraph — age, build, face (shape, eyes, skin, hair),
  wardrobe (each garment with colour and material), one signature detail (a scar, a red scarf).
  If the user wants to choose the face, make 3 portrait candidates first (op `t2i`, `outputs: 3`)
  and let them pick.

## 2. The sheet
One image, 16:9, plain light-grey background, four views side by side: full-body front, full-body
back, full-body side profile, and a head-and-shoulders portrait. Same lighting in every view.
- Cloud: `nano-banana-pro` (best consistency across views) or `seedream-5-pro`; Higgsfield's
  `ai-influencer` for photoreal influencers. Open source: `oss-qwen-edit` from a portrait, or
  `oss-qwen-image` from text.
- Prompt: "Character reference sheet of <description>. Four views on one sheet: front, back,
  side, close portrait. Identical face, hairstyle and outfit in every view. Neutral pose, arms
  slightly away from the body. Plain light-grey background, even studio light, no text."

## 3. Verify
`check_generations` with `look: true`: the face, hair, outfit colours and the signature detail
must match in all four views, and nothing may be cut off. Redo with a stronger "identical in every
view" instruction if not.

## 4. Reuse
Tell the user to save it as a character (the "Save as character" action on the result, or the
Elements page) so it gets an `@handle` — every later prompt can then write `@handle`. Offer to
`remember` the character's description too.
