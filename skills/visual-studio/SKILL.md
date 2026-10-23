---
name: visual-studio
title: Visual Studio
description: Finished motion-design reels with MiniMax H3 in five modes — classic abstract motion, high-energy kinetic graphics, animated typography, infographics, and product-only commercials — from a brief, a style reference, product assets or a storyboard.
when_to_use: The user wants a motion-graphics style video, a kinetic typography clip, an animated infographic, an abstract loop, or a product-only commercial without people. Not for still images, live-action stories (short-film) or editing existing footage.
icon: sparkles
studio: /video?model=minimax-h3
tags: [motion design, typography, infographic, video]
offline:
  kind: video
  aspect: "9:16"
  style: "premium motion design, bold geometric shapes, smooth easing, kinetic typography, clean gradients, seamless transitions"
---

# Visual Studio

MiniMax H3 (`minimax-h3`, or `minimax-h3-max` for higher quality and extend) is strong at
graphic motion, readable animated text and smooth transitions. Open source: `oss-ltx25` or
`oss-wan22-14b` (less reliable with text — keep words short).

## Pick one mode
| Mode | Prompt shape |
|---|---|
| Classic | abstract shapes, gradients, loops; "seamless loop" |
| High motion | fast cuts, whip transitions, beat-driven; name the tempo |
| Typography | the exact words in quotes, one phrase per beat, the type style |
| Infographic | the numbers and labels in quotes, chart type, build-up order |
| Product reel | the product photo as reference, macro moves, light sweeps, no people |

## Build
1. Write the beats (3–6), each with its on-screen text (≤ 4 words), the motion and the transition.
2. For a product reel or a style reference, pass the image(s) in `images` (op `i2v` for a start
   frame, `ref2v` for references). Otherwise op `t2v`.
3. Short reels: one job with `shots` (multi-shot) or one prompt with the beats in order. Longer:
   one job per beat, joined with op `concat`.
4. Music: op `music` with the tempo (e.g. "128 bpm electronic, punchy"), muxed on (op `mux`).

## Check
`check_generations` with `look: true` isn't available for video frames — ask the user to confirm
the text reads correctly, and offer to redo a beat with fewer words if not.
