import "server-only";
import type { AssistMemory, ContextFact, Skill } from "@/lib/assist";
import { describeRule, zoneLabel, type ScheduleRule } from "@/lib/assist-schedule";
import type { Engine } from "@/lib/catalog/types";
import { db } from "../db";
import { engineMode } from "../settings";
import { enabledSkills, getSkill } from "../skills";
import { memoriesFor } from "./memory";
import { getProject } from "./projects";

/**
 * What the agent knows about this chat beyond the fixed instructions: the date, engine and
 * approval mode, the project (instructions and sources), memory, the skills it can load and the
 * ones loaded. Rendered as the chat's second system block when it starts; later changes reach the
 * model as appended "Context update" messages (see contextUpdate in lib/assist.ts).
 */

const MEMORY_ITEMS = 80;
const MEMORY_CHARS = 8000;
const SKILL_INDEX = 60;
const SKILL_BODY = 30_000;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, "")}…` : s);

export interface ChatInfo {
  engine: Engine;
  autoApprove: boolean;
  projectId: string | null;
  /** Loaded skills. */
  skills: string[];
  /** Auto-run's cost cap in USD (a scheduled run's). */
  capUsd?: number | null;
  /** The scheduled task that started the chat. */
  scheduleId?: string | null;
}

export function engineLine(engine: Engine): string {
  const mode = engineMode();
  return mode === "open"
    ? "This install runs open-source models only (ComfyUI on the user's GPU)."
    : mode === "cloud"
      ? "This install runs paid cloud APIs only."
      : engine === "open"
        ? "The user prefers open-source models (ComfyUI, free on their GPU); use paid ones only when no open model can do the job, and say so."
        : "The user prefers paid cloud models (best quality); open-source models are available too.";
}

export const approvalLine = (autoApprove: boolean, capUsd: number | null = null) =>
  autoApprove
    ? capUsd !== null
      ? `Auto-run is on up to $${capUsd.toFixed(2)} for this chat: generations within it start without an approval card; a plan that would pass it, or whose price isn't known, waits for the user's approval. Keep plans within what the user asked for.`
      : "Auto-run is on: generations start without an approval card, so keep plans within what the user asked for. Memories you save are kept straight away."
    : "Ask-first is on: each generate call (and each memory you save) shows an approval card.";

/** The line a scheduled run's context gets: nobody is watching, so the job is done end to end. */
function scheduleLine(id: string): string | null {
  const r = db().prepare("SELECT title, rule_json, tz FROM assist_schedules WHERE id = ?").get(id) as { title: string; rule_json: string; tz: string } | undefined;
  if (!r) return null;
  const when = `${describeRule(JSON.parse(r.rule_json) as ScheduleRule)}, ${zoneLabel(r.tz)}`;
  return `This chat is a scheduled run of the task “${r.title}” (${when}). Nobody is watching it live: don't ask questions — make sensible choices, do the whole job, and end with a short summary of what you made.`;
}

/** A project's own skills that still exist (a deleted or renamed one drops out). */
function projectSkills(project: { skills: string[] } | null): Skill[] {
  return project?.skills.map((n) => getSkill(n)).filter((s): s is Skill => !!s) ?? [];
}

/** The skills a chat can use: a project's own list when it has one that resolves, else every enabled skill. */
export function skillsFor(projectId: string | null): Skill[] {
  const own = projectSkills(projectId ? getProject(projectId) : null);
  return own.length ? own : enabledSkills();
}

export function canUseSkill(name: string, projectId: string | null): boolean {
  return skillsFor(projectId).some((s) => s.name === name);
}

export function memoryLine(m: AssistMemory): string {
  return `- (${m.id}) [${m.category}] ${m.text}${m.scope === "project" ? " (project)" : ""}`;
}

export function chatFacts(c: ChatInfo, now = new Date()): ContextFact[] {
  const facts: ContextFact[] = [
    { section: "now", key: "date", text: `Today is ${now.toISOString().slice(0, 10)}.` },
    { section: "now", key: "engine", text: engineLine(c.engine) },
    { section: "now", key: "approval", text: approvalLine(c.autoApprove, c.capUsd ?? null) },
  ];
  const scheduled = c.scheduleId ? scheduleLine(c.scheduleId) : null;
  if (scheduled) facts.push({ section: "now", key: "scheduled", text: scheduled });
  const project = c.projectId ? getProject(c.projectId) : null;
  if (project) {
    facts.push({
      section: "project",
      key: "about",
      text: [
        `This chat is in the project “${project.name}”.`,
        project.instructions ? `The project's instructions — follow them:\n${project.instructions}` : "It has no extra instructions.",
        projectSkills(project).length ? `Only the project's skills are available here.` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
    for (const s of project.sources) {
      const where = s.kind === "element" ? ` — ${s.excerpt?.split("\n")[0] ?? ""}` : s.url ? ` — ${s.url}` : "";
      const body =
        s.status === "error"
          ? ` (couldn't be read: ${clip(s.error ?? "", 120)})`
          : s.chars
            ? ` — ${s.chars.toLocaleString("en")} characters, starts: “${clip((s.excerpt ?? "").replace(/\s+/g, " "), 160)}” (read_source for the full text)`
            : s.kind === "image" || s.kind === "video" || s.kind === "audio"
              ? " (pass the URL as an input)"
              : "";
      facts.push({ section: "sources", key: s.id, text: `- [${s.id}] ${s.kind}: ${s.title}${where}${body}` });
    }
  }
  const memories = memoriesFor(project?.id ?? null, project?.usePersonalMemory ?? true);
  let chars = 0;
  for (const m of memories.slice(0, MEMORY_ITEMS)) {
    const line = memoryLine(m);
    chars += line.length;
    if (chars > MEMORY_CHARS) break;
    facts.push({ section: "memory", key: m.id, text: line });
  }
  const available = skillsFor(project?.id ?? null);
  for (const s of available.slice(0, SKILL_INDEX)) {
    facts.push({ section: "skills", key: s.name, text: clip(`- /${s.name} — ${s.title}: ${s.description}${s.whenToUse ? ` Use when: ${s.whenToUse}` : ""}`, 520) });
  }
  for (const name of c.skills) {
    const s = getSkill(name);
    if (!s) continue;
    const files = s.files.length ? `\n\n(Files with this skill, readable with load_skill and file: ${s.files.map((f) => f.path).join(", ")})` : "";
    facts.push({ section: "active", key: s.name, text: `### /${s.name} — ${s.title}\n${clip(s.body, SKILL_BODY)}${files}` });
  }
  return facts;
}
