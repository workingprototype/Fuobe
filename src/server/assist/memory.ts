import "server-only";
import { nanoid } from "nanoid";
import { MEMORY_CATEGORIES, MEMORY_MAX_CHARS, type AssistMemory, type MemoryCategory, type MemoryScope } from "@/lib/assist";
import { db } from "../db";

/**
 * Assist memory: short typed notes about the user (Supercomputer's Memory). Personal memories
 * apply to every chat; project memories only inside their project (and a project can leave
 * personal memory out). The agent adds them with its remember tool; people add, edit, delete
 * and import them on the Memory page.
 */

export class MemoryError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

interface Row {
  id: string;
  scope: MemoryScope;
  project_id: string | null;
  category: MemoryCategory;
  text: string;
  source: AssistMemory["source"];
  created_at: number;
  updated_at: number;
}

const toMemory = (r: Row): AssistMemory => ({
  id: r.id,
  scope: r.scope,
  projectId: r.project_id,
  category: r.category,
  text: r.text,
  source: r.source,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const tidy = (t: string) => t.replace(/\s+/g, " ").trim();
const key = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Memories for a filter, newest first. scope "all" = personal and every project's. */
export function listMemories(f: { scope?: MemoryScope | "all"; projectId?: string | null } = {}): AssistMemory[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (f.scope === "personal") where.push("scope = 'personal'");
  else if (f.scope === "project") {
    where.push("scope = 'project'");
    if (f.projectId) {
      where.push("project_id = ?");
      args.push(f.projectId);
    }
  }
  const sql = `SELECT * FROM assist_memory ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC LIMIT 1000`;
  return (db().prepare(sql).all(...args) as Row[]).map(toMemory);
}

/** What a chat sees: its project's memories, plus personal ones unless the project leaves them out. */
export function memoriesFor(projectId: string | null, usePersonal = true): AssistMemory[] {
  const project = projectId ? listMemories({ scope: "project", projectId }) : [];
  const personal = !projectId || usePersonal ? listMemories({ scope: "personal" }) : [];
  return [...project, ...personal];
}

export function getMemory(id: string): AssistMemory | null {
  const r = db().prepare("SELECT * FROM assist_memory WHERE id = ?").get(id) as Row | undefined;
  return r ? toMemory(r) : null;
}

function check(text: string, category: string, scope: MemoryScope, projectId: string | null) {
  const t = tidy(text);
  if (!t) throw new MemoryError("Write what to remember");
  if (t.length > MEMORY_MAX_CHARS) throw new MemoryError(`Keep a memory under ${MEMORY_MAX_CHARS} characters — split it into a few`);
  if (!(MEMORY_CATEGORIES as readonly string[]).includes(category)) throw new MemoryError(`Pick a category: ${MEMORY_CATEGORIES.join(", ")}`);
  if (scope === "project" && !projectId) throw new MemoryError("A project memory needs its project");
  if (scope === "project" && !db().prepare("SELECT 1 FROM assist_projects WHERE id = ?").get(projectId)) throw new MemoryError("That project doesn't exist anymore", 404);
  return t;
}

/** Add a memory; the same text in the same place updates the existing one instead of duplicating it. */
export function addMemory(input: { text: string; category: MemoryCategory; scope?: MemoryScope; projectId?: string | null; source?: AssistMemory["source"] }): AssistMemory {
  const scope = input.scope ?? (input.projectId ? "project" : "personal");
  const projectId = scope === "project" ? (input.projectId ?? null) : null;
  const text = check(input.text, input.category, scope, projectId);
  const now = Date.now();
  const same = listMemories({ scope, projectId }).find((m) => key(m.text) === key(text));
  if (same) {
    db().prepare("UPDATE assist_memory SET category = ?, text = ?, updated_at = ? WHERE id = ?").run(input.category, text, now, same.id);
    return getMemory(same.id)!;
  }
  const id = nanoid(10);
  db()
    .prepare("INSERT INTO assist_memory (id, scope, project_id, category, text, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, scope, projectId, input.category, text, input.source ?? "user", now, now);
  return getMemory(id)!;
}

export function updateMemory(id: string, patch: { text?: string; category?: MemoryCategory }): AssistMemory {
  const cur = getMemory(id);
  if (!cur) throw new MemoryError("That memory doesn't exist anymore", 404);
  const text = check(patch.text ?? cur.text, patch.category ?? cur.category, cur.scope, cur.projectId);
  db().prepare("UPDATE assist_memory SET text = ?, category = ?, updated_at = ? WHERE id = ?").run(text, patch.category ?? cur.category, Date.now(), id);
  return getMemory(id)!;
}

export function deleteMemory(id: string): boolean {
  return db().prepare("DELETE FROM assist_memory WHERE id = ?").run(id).changes > 0;
}

/** Add many (an import), skipping ones already there. Returns how many were new. */
export function importMemories(items: { text: string; category: MemoryCategory }[], scope: MemoryScope, projectId: string | null): { added: number; skipped: number } {
  const existing = new Set(listMemories({ scope, projectId }).map((m) => key(m.text)));
  let added = 0;
  db().transaction(() => {
    for (const it of items.slice(0, 200)) {
      const t = tidy(it.text).slice(0, MEMORY_MAX_CHARS);
      if (!t || existing.has(key(t))) continue;
      existing.add(key(t));
      addMemory({ text: t, category: it.category, scope, projectId, source: "import" });
      added++;
    }
  })();
  return { added, skipped: Math.min(items.length, 200) - added };
}

export function deleteProjectMemories(projectId: string): void {
  db().prepare("DELETE FROM assist_memory WHERE scope = 'project' AND project_id = ?").run(projectId);
}
