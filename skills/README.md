# Built-in Assist skills

Each folder holds one skill: a `SKILL.md` with YAML frontmatter and Markdown instructions, the
same format as Anthropic's Agent Skills and Higgsfield Supercomputer's skills. Assist lists them
under **Assist → Skills → Built-in**, the agent loads one with its `load_skill` tool when a request
matches, and typing `/name` at the start of a message loads it for that chat.

```markdown
---
name: product-photoshoot            # required: lowercase letters, numbers, hyphens (≤ 64)
title: Product Photographer         # shown in the app
description: What it does …         # required (≤ 1024 characters)
when_to_use: When the agent should load it …
icon: package                       # a lucide icon name the Skills page knows
studio: /apps/app-packshot          # the Fuobe page that does the job by hand
tags: [product, ecommerce]
offline:                            # hints for the offline planner (no LLM connected)
  kind: image                       # image | video | audio | text
  aspect: "1:1"
  outputs: 4
  style: "words appended to the prompt"
---

# Instructions the agent follows …
```

Files are read from disk at run time (`src/server/skills.ts`), so editing one here changes Assist
on the next request. People add their own skills on the Skills page or by uploading a `.zip`,
`.skill` or `SKILL.md` file; those live in the database, not here.
