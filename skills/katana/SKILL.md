---
name: katana
title: Katana
description: Remix a reference edit for your subject — recreate a short video's cuts, motion and soundtrack with the user's own person or product — or edit the user's own footage into a finished video.
when_to_use: The user supplies a reference video and photos of a subject and says "make this edit with me", "do this trend with my product", or invokes /katana with a reference and subject (no further brief needed). Also for "edit my footage like this".
icon: scissors
studio: /katana
tags: [remix, trend, edit, video]
offline:
  kind: video
  aspect: "9:16"
---

# Katana

Katana keeps the reference's timing, camera motion and soundtrack, and puts the user's subject in it.

## Inputs
- A reference video (1–30 s): an attachment, or an earlier result via `list_recent`.
- 1–5 photos of the subject (person or product), or a saved `@element`.
- With `/katana` plus a reference and photos, no text brief is needed: make the remix.

## With the katana tool (preferred)
If a `katana` tool is listed, call it with the reference and the photos — it detects the cuts,
swaps the subject into each segment's first frame, regenerates every segment with the reference's
motion, joins them at the original cut times and keeps the original soundtrack. One approval.

## Without it (build the chain)
1. Ask for or estimate the cut points (or treat a short reference as one segment).
2. Per segment: op `trim` (`start_time`, `end_time`) → the segment's first frame with the subject
   swapped in (op `edit` with the frame and the subject photo; cloud `nano-banana-pro`, open
   `oss-qwen-edit`) → regenerate the segment following the original motion (op `motion-transfer`
   or `v2v`: cloud `kling-o3` video edit or `kling-motion-control`, open `oss-wan22-animate`).
3. Join the segments in order (op `concat`) and put the reference's audio back (op `mux`).

## Own footage
Edit the user's clip by the brief: restyle with the `restyle_footage` tool, trim and join with
video-montage steps, captions with `add_captions`.

Say up front that each segment is regenerated, so faces and products can drift slightly between
cuts; offer to redo a weak segment.
