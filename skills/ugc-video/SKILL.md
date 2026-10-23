---
name: ugc-video
title: UGC Studio
description: Finished UGC-style videos in six creator formats — creator review, product-only voiceover, unboxing, wearable try-on, step-by-step tutorial and website tour — from a product (and optionally a creator photo).
when_to_use: The user asks for a UGC video, a creator-style review, a TikTok/Reels ad with a person talking about the product, an unboxing, a try-on or a tutorial video. Not for scripts alone (use youtube-script) or cinematic commercials (use short-film).
icon: smartphone
studio: /marketing?template=ugc-honest-review
tags: [ugc, ads, video, social]
offline:
  kind: video
  aspect: "9:16"
  style: "handheld smartphone footage, natural window light, authentic creator style, vertical framing"
---

# UGC Studio

UGC works because it looks real: a phone camera, natural light, a person talking to camera,
quick cuts. Pick **one** format from the brief:

| Format | When | Shape |
|---|---|---|
| Creator review | "review", "testimonial", "talking about" | creator holds the product, talks to camera |
| Product-only voiceover | no person wanted | close product shots + voice-over |
| Unboxing | "unboxing", new arrival | hands open the box, reveal |
| Try-on | clothing, shoes, jewellery, glasses | creator wears it, mirror or full body |
| Tutorial | "how to", steps | 3–5 short steps with the product |
| Website tour | an app or a site | screen recording style + creator reaction |

A product link alone doesn't mean "website tour".

## 1. Inputs
Product photo (attachment, `@element` or `list_recent`), and a creator photo if the user has one.
Without a creator photo, generate one: a `generate` job with op `t2i` ("a relatable 25-year-old
creator, natural makeup, casual hoodie, bedroom with soft window light, phone selfie framing").
Save time: if the user has a saved character, use its `@handle`.

## 2. Script (always write it first)
Write a 15–30 second script in the chat or with a `write` job (`text-llm` / `oss-text-llm`):
a hook in the first 2 seconds ("I didn't expect this to work…"), 2–3 concrete benefits, a call to
action. Keep sentences short and spoken. Show the script and the plan in one message.

## 3. Production chain (one `generate` call with `after`)
1. **Key frame** — op `edit` with the creator photo and the product photo in `images`:
   "the creator holds the product at chest height, smartphone selfie framing, 9:16".
   Cloud `nano-banana-pro`, open `oss-qwen-edit`.
2. **Voice** — op `tts`: the script. Cloud `elevenlabs-v4` (pick a natural voice), open `oss-chatterbox`.
3. **Talking video** — op `avatar` with the key frame (`after` step 1) and the voice as `audio`
   (or chain the voice with a second `after`, see generate's description). Cloud `kling-avatar-2`
   or `omnihuman-2`, open `oss-infinitetalk`.
For product-only voiceover: replace step 3 with 2–3 `i2v` product clips (5 s each, handheld
push-ins) and join them, then put the voice on with op `mux`.

## 4. Finish
Offer captions (the `add_captions` tool), a second hook variant, or a 1:1 cut. Check results with
`check_generations` and say which take is strongest.
