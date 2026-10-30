/**
 * People, teams and requests for tests (docs/research/accounts-8.md §13). Every test acts as the local owner, "Just me
 * on this computer" (tests/setup/actor.ts); these helpers seed other people, roles and teams, act as nobody or as
 * someone else, and build the requests a browser or a CLI would send: from this computer, with a bearer token, or
 * with a session cookie (tests/helpers/identity.ts signs the owner in). Each test file sets FUOBE_DATA_DIR before
 * importing Fuobe.
 */
import crypto from "node:crypto";
import { enterAs, LOCAL_OWNER, maybeActor, runAs, SYSTEM, type Actor } from "@/server/access/actor";
import type { TeamRole } from "@/server/access/permissions";
import { db } from "@/server/db";
import { createToken } from "@/server/identity/tokens";

export { LOCAL_OWNER, maybeActor, runAs, SYSTEM };

/** The rest of this test runs as nobody: server code that asks who is acting throws. */
export function asNobody(): void {
  enterAs(null);
}

/** The rest of this test runs as `actor` (the local owner by default). */
export function actAs(actor: Actor = LOCAL_OWNER): void {
  enterAs(actor);
}

/** An actor as handler() would resolve it (a session by default). */
export function actor(userId: string, role = "member", o: Partial<Actor> = {}): Actor {
  return { userId, role, via: "session", scopes: ["full"], ...o };
}

export interface SeedPerson {
  id?: string;
  role?: string;
  status?: "active" | "pending" | "disabled" | "deleted";
  dormant?: boolean;
}

/** A person (a `users` row) with a personal workspace they own. Returns their id. */
export function seedPerson(p: SeedPerson = {}): string {
  const id = p.id ?? `u_${crypto.randomBytes(6).toString("hex")}`;
  const ws = `w_${id.slice(2)}`;
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO users (id, role, status, dormant, personal_workspace_id, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'admin', ?, ?)`,
    )
    .run(id, p.role ?? "member", p.status ?? "active", p.dormant ? 1 : 0, ws, now, now);
  db().prepare("INSERT INTO workspaces (id, kind, name, slug, created_by, created_at, updated_at) VALUES (?, 'personal', 'Personal', ?, ?, ?, ?)").run(ws, ws, id, now, now);
  db().prepare("INSERT INTO workspace_members (workspace_id, user_id, role, source, created_at) VALUES (?, ?, 'owner', 'manual', ?)").run(ws, id, now);
  return id;
}

/** Change a seeded person (turn them off, make them dormant, change their role). */
export function updatePerson(id: string, p: Omit<SeedPerson, "id">): void {
  if (p.role) db().prepare("UPDATE users SET role = ? WHERE id = ?").run(p.role, id);
  if (p.status) db().prepare("UPDATE users SET status = ? WHERE id = ?").run(p.status, id);
  if (p.dormant !== undefined) db().prepare("UPDATE users SET dormant = ? WHERE id = ?").run(p.dormant ? 1 : 0, id);
}

/** A team workspace with these members and roles. Returns its id. */
export function seedTeam(name: string, members: Record<string, TeamRole>): string {
  const id = `w_${crypto.randomBytes(6).toString("hex")}`;
  const now = Date.now();
  db().prepare("INSERT INTO workspaces (id, kind, name, slug, created_at, updated_at) VALUES (?, 'team', ?, ?, ?, ?)").run(id, name, id, now, now);
  for (const [userId, role] of Object.entries(members)) {
    db().prepare("INSERT INTO workspace_members (workspace_id, user_id, role, source, created_at) VALUES (?, ?, ?, 'manual', ?)").run(id, userId, role, now);
  }
  return id;
}

/** A live API token for a person, with these scopes (Full by default). Returns the token itself. */
export function tokenFor(userId: string, scopes: string[] = ["full"]): string {
  const { token, info } = createToken(userId, "Test");
  db().prepare("UPDATE api_tokens SET scopes = ? WHERE id = ?").run(scopes.join(","), info.id);
  return token;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Sent as Authorization: Bearer … */
  bearer?: string;
  /** Sent as the Cookie header (tests/helpers/identity.ts ownerCookie). */
  cookie?: string;
  /** The address the request arrives at (localhost: Just me on this computer when sign-in is off). */
  origin?: string;
}

/** A request the way a browser or the CLI sends it to `path`. */
export function request(path: string, o: RequestOptions = {}): Request {
  const origin = o.origin ?? "http://localhost:3000";
  const headers: Record<string, string> = { host: new URL(origin).host, ...o.headers };
  if (o.bearer) headers.authorization = `Bearer ${o.bearer}`;
  if (o.cookie) headers.cookie = o.cookie;
  const method = o.method ?? (o.body === undefined ? "GET" : "POST");
  if (o.body !== undefined) headers["content-type"] ??= "application/json";
  return new Request(new URL(path, origin), { method, headers, ...(o.body !== undefined && { body: typeof o.body === "string" ? o.body : JSON.stringify(o.body) }) });
}
