---
name: ad-multiplier
description: Turn one winning video ad into many variants — new hooks, new CTAs, new settings, new subjects or products — keeping what works in the original (timing, structure, audio), for testing on paid social.
compatibility: Needs a Fuobe server. Fuobe Assist runs these steps itself; other agents call the same tools on Fuobe's MCP endpoint (/api/mcp) or use the fuobe CLI.
metadata:
  title: Ad Multiplier
  when_to_use: The user has an existing video ad (4–30 s) and wants variations, A/B versions, "new hooks for this ad", "the same ad with our other product" or "localised versions". Needs the reference video.
  icon: copy
  studio: /ads/multiplier
  tags: ads, variants, video, testing
  offline_kind: video
  offline_aspect: "9:16"
---

# Ad Multiplier

## Pick what varies (one axis per batch, so results are testable)
| Variant | How |
|---|---|
| **Prompt** (scene, style, subject) | video edit of the whole ad |
| **Hook** (first 2–4 s) | a new opening clip from the first frame, joined before the rest |
| **CTA** (last 2–4 s) | a new closing clip from the last frame, joined after |
Prompt is exclusive with Hook/CTA; Hook and CTA can be combined.

## Whole-ad variants (Prompt)
Op `v2v` with the ad in `video` and the change described precisely ("same shots and timing; the
creator is now in a sunny kitchen; the product is the green bottle from the image"), product or
subject photos in `images`. Cloud `kling-o3` (video edit with up to 4 references), `happy-horse-video-edit`,
`gemini-omni-flash`; open (with `engine: "open"`) `fuobe-mixed-media` (every frame redrawn in the
look, one seed; it reads no photos) or `fuobe-shorts` (Wan 2.2 Fun VACE carries a restyled first
frame, given in `images`, through the ad). Resolution 1080p by default (480p for quick tests).
3–5 variants per batch, each one `generate` job.

## Hook / CTA variants
1. Get the first (or last) frame: op `frame` on the ad, or ask the user for a screenshot.
2. Make a 2–4 s clip from it (op `i2v`) with the new hook action or CTA moment, and the line in
   quotes if spoken.
3. Join: op `concat` with [new hook, original ad] or [original ad, new CTA]. Keep the original
   audio for the body; the new clip carries its own (`generate_audio`).

## Hand-off
Name each variant by what changed ("Hook B — the spill") so the user can track them in their ad
manager. Offer captions (`add_captions`) and 1:1 / 4:5 crops (video-repurposer).

## Using Fuobe from an agent
Outside Fuobe Assist (Claude Code, Codex, Cursor…), connect Fuobe's MCP server (`fuobe mcp` prints
the command) and call the same tools: `generate` with one job per variant (op `v2v`), or the hook /
CTA chain with `after`, then `check_generations` for the results; `add_captions` for captions. Price
a run with `estimate_cost` (or `estimate_job` for a studio tool) and confirm it with the user first.
Files go in as URLs: `fuobe upload <file>` prints one. Without MCP, the `fuobe` CLI runs the same
jobs (`fuobe generate`, `fuobe tool <name>`).
