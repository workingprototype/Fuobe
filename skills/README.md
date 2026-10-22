# Built-in Assist skills

Each folder holds one skill: a `SKILL.md` with YAML frontmatter and Markdown instructions, in the
[Agent Skills](https://agentskills.io/specification) format that Claude Code, Codex, Cursor and
Higgsfield Supercomputer read. Assist lists them under **Assist → Skills → Built-in**, the agent
loads one with its `load_skill` tool when a request matches, and typing `/name` at the start of a
message loads it for that chat. MCP clients get them as prompts.

```markdown
---
name: product-photoshoot            # required: lowercase letters, numbers, hyphens (≤ 64); the folder's name
description: What it does …         # required (≤ 1024 characters): what it does and when to use it
compatibility: Needs a Fuobe server …   # optional (≤ 500 characters)
metadata:                           # Fuobe's own fields: one line each, strings only
  title: Product Photographer       # shown in the app
  when_to_use: When the agent should load it …
  icon: package                     # a lucide icon name the Skills page knows
  studio: /apps/app-packshot        # the Fuobe page that does the job by hand
  tags: product, ecommerce          # comma-separated
  offline_kind: image               # hints for the offline planner (no LLM): image | video | audio | text
  offline_aspect: "1:1"
  offline_outputs: "4"
  offline_style: words appended to the prompt
---

# Instructions the agent follows …

## Using Fuobe from an agent
Which Fuobe MCP tools another agent calls for this job.
```

The spec allows only `name`, `description`, `license`, `compatibility`, `allowed-tools` and a
string-to-string `metadata` map at the top level, so Fuobe's fields live under `metadata`. Fuobe
still reads files that have them at the top level (`title:`, `tags: [a, b]`, an `offline:` map),
as skills written before round 4 do. `tests/skills-spec.test.ts` checks every file here against
the spec and against Fuobe's parser.

Files are read from disk at run time (`src/server/skills.ts`), so editing one here changes Assist
on the next request. People add their own skills on the Skills page, by uploading a `.zip`,
`.skill` or `SKILL.md` file, or with `fuobe skills add`; those live in the database, not here.

## Installing them in other agents

The open `skills` CLI finds these folders (and `.agents/skills/fuobe`, the skill that teaches an
agent to drive Fuobe) and copies or links them into an agent's skills directory:

```bash
npx skills add workingprototype/Fuobe --list          # what's here
npx skills add workingprototype/Fuobe --skill fuobe   # just the Fuobe skill
npx skills add workingprototype/Fuobe -a claude-code  # all of them, for Claude Code
```

The playbooks call Fuobe's MCP tools (`generate`, `check_generations`, `katana`…), so the agent
needs the Fuobe MCP server connected: `fuobe mcp` prints the command (see `docs/cli.md`).
