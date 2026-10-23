---
name: youtube-script
description: A complete YouTube script with a full spoken body in one of six genres — business and finance, tech review, commentary or video essay, storytelling or documentary, true crime, or explainer and education — plus hook options, timestamps, production cues and a retention map.
compatibility: Needs a Fuobe server. Fuobe Assist runs these steps itself; other agents call the same tools on Fuobe's MCP endpoint (/api/mcp) or use the fuobe CLI.
metadata:
  title: YouTube Script
  when_to_use: The user asks for a YouTube script, a video script, an outline with hooks, or "write the script for my video". The deliverable is text; offer to produce the video afterwards with faceless-video or narration.
  icon: file-text
  tags: youtube, script, writing
  offline_kind: text
---

# YouTube Script

## Genre playbooks
| Genre | Hook style | Structure |
|---|---|---|
| Business / finance | a surprising number or a costly mistake | problem → 3 lessons → takeaway |
| Tech review | the verdict up front, then "but…" | verdict → design → performance → who it's for |
| Commentary / video essay | a provocative claim | claim → evidence → counterpoint → conclusion |
| Storytelling / documentary | drop into the most dramatic moment | cold open → background → escalation → resolution |
| True crime | the unanswered question | the case → timeline → theories → what we know |
| Explainer / education | "by the end you'll know…" | why it matters → 3–5 steps → recap |

## Deliverable (one message, in this order)
1. **Three hook options** (first 15 seconds, spoken), labelled by angle.
2. **The script**: full spoken text, not bullet points. Timestamps every section `[00:00]`,
   production cues in brackets `[B-roll: server racks]`, `[On-screen text: 72%]`, `[Cut to …]`.
   ~150 spoken words per minute; hit the requested length (default 8 minutes).
3. **Retention map**: where attention dips and the pattern interrupt planned there (a question, a
   visual change, a story beat) every 60–90 seconds, plus the open loop that carries to the end.
4. **Title and thumbnail ideas**: 3 titles under 60 characters, 2 thumbnail concepts.

## How
Write it yourself in the chat for normal lengths. For very long scripts or when the user wants a
file, use `generate` with op `write` (`text-llm` / `oss-text-llm`) and put the genre, length and
structure in `system`. Ask one question at most (the genre or the audience) when the topic leaves
it open. Offer next steps: narrate it (narration), produce it (faceless-video), or a thumbnail.

## Using Fuobe from an agent
Outside Fuobe Assist (Claude Code, Codex, Cursor…) the script is yours to write: answer in your own
reply. Fuobe is only needed for a long script delivered as a file (its `generate` tool with op
`write` over MCP; `fuobe mcp` prints the command) or for the next steps (narration,
faceless-video), which say which Fuobe tools to call.
