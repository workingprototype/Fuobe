---
name: video-montage
description: Assembly and post-processing for existing video files — concatenate, stitch or merge clips into one file, lay music under them, attach or burn subtitles, trim — returning one finished rendered file.
compatibility: Needs a Fuobe server. Fuobe Assist runs these steps itself; other agents call the same tools on Fuobe's MCP endpoint (/api/mcp) or use the fuobe CLI.
metadata:
  title: Video Montage
  when_to_use: The user has clips (uploaded or made earlier) and wants them joined, cut, given music or captions; "stitch these", "make a montage", "put music on this", "burn in subtitles". Also the final step other skills hand off to.
  icon: film
  studio: /video-tools/join
  tags: edit, join, music, captions
  offline_kind: video
---

# Video Montage

## 1. Collect the clips
Use the attachments in the order the user gave them; earlier results via `list_recent` (kind
video). Confirm the order in one line if it isn't obvious ("I'll join them in the order you
uploaded: beach, sunset, fire").

## 2. Steps (one `generate` call, each later step `after` the previous)
1. **Trim** each clip if asked: op `trim` with `start_time` / `end_time` (cloud `trim-video`,
   open `oss-trim`).
2. **Join**: op `concat` with the clips in `video`/order (cloud `join-clips` takes many clips;
   open `oss-join-clips` joins up to 4 per step — join in groups, then join the groups). The
   result plays at the first clip's frame rate; mention it if the clips differ.
3. **Music**: make a bed with op `music` (cloud `sonilo-music`, open `oss-ace-step`; describe
   genre, tempo, mood, "instrumental, no vocals", and the length of the montage), or use the
   user's track. Put it on with op `mux` (cloud `merge-audio-video`, open `oss-mux`); to keep the
   clips' own sound under the music on open source, pass it as `background_audio`.
4. **Subtitles**: the `add_captions` tool on the final file.

## 3. Deliver
`check_generations` until the last step finishes; reply with the length and what was applied.
Offer a vertical cut (load video-repurposer) or a different track.

## Using Fuobe from an agent
Outside Fuobe Assist (Claude Code, Codex, Cursor…), connect Fuobe's MCP server (`fuobe mcp` prints
the command) and call the same tools: `generate` with the trim → join → music → mux chain (`after`),
then `add_captions`. Price a run with `estimate_cost` (or `estimate_job` for a studio tool) and
confirm it with the user first. Files go in as URLs: `fuobe upload <file>` prints one. Without MCP,
the `fuobe` CLI runs the same jobs (`fuobe generate`, `fuobe tool <name>`).
