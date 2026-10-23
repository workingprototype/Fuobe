---
name: marketing-studio-cards
description: Posters, Meta and Instagram ad creatives and marketplace listing cards built around the user's own product photo, with a designed layout, a headline, short copy and a call to action.
compatibility: Needs a Fuobe server. Fuobe Assist runs these steps itself; other agents call the same tools on Fuobe's MCP endpoint (/api/mcp) or use the fuobe CLI.
metadata:
  title: Marketing Studio Cards
  when_to_use: The user wants a designed advertising still around their product — "make a poster", "an Instagram ad", "a sale banner", "a promo card", "an ad with our tagline". The product photo is required. For plain product photos use product-photoshoot; for many ads at once use the create_ads tool.
  icon: megaphone
  studio: /marketing
  tags: ads, poster, marketing, social
  offline_kind: image
  offline_aspect: "4:5"
  offline_outputs: "2"
  offline_style: "modern advertising layout around the product photo, bold headline at the top, short supporting line, call-to-action button at the bottom, brand colours, generous whitespace, crisp typography"
---

# Marketing Studio Cards

## 1. Copy first
From the brief (and memory: brand colours, tone), write:
- a headline of 2–6 words (benefit or offer: "Sleep like it's Sunday", "30% off this week"),
- one supporting line (≤ 12 words),
- a CTA of 1–3 words ("Shop now", "Try it free").
Keep brand and product names exact. If a project source has a brand guide, read it with `read_source`.

## 2. Layout families (pick one per card, vary across a set)
| Layout | Good for |
|---|---|
| Hero centre — product big in the middle, headline above, CTA below | launches |
| Split — product one side, copy the other | feature callouts |
| Offer burst — big % or price badge | sales |
| Lifestyle + overlay — product in scene, copy on a band | social feed |
| Listing card — white background, 3 benefit icons with labels | marketplaces |
| Testimonial — a short quote with stars | trust |

## 3. Generate
- One job per card (op `edit` with the product photo in `images`, so the product stays exact).
  Quote every text element exactly and say "no other text".
- Models: `nano-banana-pro` (best product fidelity + text), `ideogram-4-5` (best typography),
  Higgsfield's `marketing-studio-image` when connected. Open source: `oss-qwen-edit`.
- Ratios: 4:5 feed, 9:16 Stories, 1:1 marketplaces, 16:9 banners. For "the full set", 4:5 + 9:16 + 1:1.

## 4. QC
`check_generations` with `look: true`: spelling, the CTA present, the product undistorted, text
not over the product. Redo failures. Offer more variants with the `create_ads` tool, or
animated versions (op `i2v`, subtle motion, 5 s).

## Using Fuobe from an agent
Outside Fuobe Assist (Claude Code, Codex, Cursor…), connect Fuobe's MCP server (`fuobe mcp` prints
the command) and call the same tools: `generate` with one `edit` job per card, `check_generations`
with `look: true`, and `create_ads` for a batch of ads. Price a run with `estimate_cost` (or
`estimate_job` for a studio tool) and confirm it with the user first. Files go in as URLs:
`fuobe upload <file>` prints one. Without MCP, the `fuobe` CLI runs the same jobs (`fuobe generate`,
`fuobe tool <name>`).
