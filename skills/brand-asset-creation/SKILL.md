---
name: brand-asset-creation
title: Brand Asset Creation
description: Logos and a brand kit from scratch or from the user's existing assets — logo concepts, palette, typography direction, a one-page brand board, and branded applications such as mockups, merchandise, packaging and signage.
when_to_use: The user wants a new brand identity, a logo, a palette, a brand board or brandbook, or branded mockups (merch, packaging, signage, social templates) — starting empty or from an uploaded logo and materials.
icon: palette
studio: /image
tags: [brand, logo, identity]
offline:
  kind: image
  aspect: "1:1"
  outputs: 4
  style: "clean vector logo mark on a plain white background, flat colours, simple geometric shapes, strong silhouette, no mockup, no extra text"
---

# Brand Asset Creation

## 1. Brief (one compact question if needed)
Name, what the business does, audience, 3 personality words (e.g. calm, premium, playful),
colours to use or avoid, and where the logo lives (app icon, signage, packaging). If the user has
a logo already, start from it — never redraw an existing logo unless asked.

## 2. Logo concepts
- 4 directions in one `generate` call, one job each: a wordmark, a lettermark/monogram, a symbol
  + wordmark lockup, and an emblem/badge. Square, plain white background, flat colours, the brand
  name spelled exactly (quote it in the prompt).
- Models: `recraft-4-1` (cloud; designed for logos and vector style), `ideogram-4-5` (exact
  lettering), `nano-banana-pro`. Open: `oss-qwen-image` (renders text well).
- Turn the chosen logo into a vector with op `vectorize` (cloud `recraft-vectorize`, `image2svg`).

## 3. The kit
After the user picks a logo:
- **Palette**: 1 primary, 1 secondary, 2 neutrals, 1 accent — give HEX codes and where each is used.
- **Typography**: a heading and a body typeface direction (free Google Fonts names when possible).
- **Brand board**: one 16:9 image with the logo, palette swatches with HEX labels, type samples and
  2 example applications (op `edit` with the logo in `images`).
- Offer to save the palette and name with `remember` (Convention) so later jobs stay on brand.

## 4. Applications
Mockups with the logo in `images` (op `edit`): business card, tote bag, storefront sign, app icon,
packaging, Instagram post template. "Place the logo from the image exactly as it is, undistorted."
Check every result with `look: true` for misspelled names or warped logos.
