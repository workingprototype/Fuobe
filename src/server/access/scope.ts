import "server-only";
import path from "node:path";
import { db } from "../db";
import { currentActor, requestScope, withScope, type Actor } from "./actor";
import { auditHidden } from "./audit";
import { ForbiddenError, NotFoundError } from "./errors";
import { effectiveTeamRole, INSTALL_OWNER_ID, teamRoleAtLeast, type TeamRole } from "./permissions";

/**
 * The data-access layer for scoped rows (docs/research/accounts-8.md §7.4–§7.6). Every row belongs to one workspace;
 * a row is visible to an actor when they are a member of its workspace, when a grant names the row or its container
 * (a folder holding a result, a result holding a file) for them, for one of their teams or for the workspace they
 * work in, or when it is in the install catalog (`w_install`). Anything else answers 404, never 403, and the denial is
 * audited as `denied.hidden` (rate-limited, src/server/access/audit.ts). Writes need the team role the action asks
 * for: Editor to change, the creator or a workspace admin to manage (restore from the Trash, delete for good).
 *
 *   get("generation", id, "edit")          → the row's workspace and creator, or a 404 / 403 refusal
 *   getMany("generation", ids, "view")     → the ids this actor may use (404 when none)
 *   list("generation", "g", { space })     → a WHERE fragment for a list in a space
 *   stamp()                                → { workspace_id, created_by } for a row this request starts
 *   rootWorkspace("generation", rootId)    → where a step started from an existing root goes (Editor there)
 *   assertReadable(ref)                    → a stored file (asset id or /api/files/ URL) the actor may read
 *
 * A token pinned to a workspace sees only that workspace, grants to it and the install catalog; a request asking for
 * another workspace is refused (handler() answers 403 before the route runs). In Personal there is one workspace and
 * nothing changes.
 */

export const INSTALL_WORKSPACE = "w_install";
/** The header each tab sends with the workspace it works in (§7.5). */
export const WORKSPACE_HEADER = "x-fuobe-workspace";

/** The scoped kinds of record, by the name grants and record pages use, and their tables. */
export const KINDS = {
  generation: "generations",
  folder: "folders",
  asset: "assets",
  element: "characters",
  cinema: "cinema_projects",
  canvas: "canvases",
  layers: "layer_projects",
  shorts: "shorts_sessions",
  "shorts-preset": "shorts_presets",
  brand: "brand_kits",
  product: "products",
  "marketing-run": "marketing_runs",
  palette: "palettes",
  moodboard: "moodboards",
  "photo-pack": "photodump_packs",
  channel: "faceless_channels",
  episode: "faceless_episodes",
  series: "content_series",
  dub: "dub_sessions",
  katana: "katana_jobs",
  "swap-project": "swap_projects",
  "assist-project": "assist_projects",
  share: "shares",
} as const;

export type Kind = keyof typeof KINDS;

/** What an action needs: to see the row, to change it (Editor or an edit grant), or to manage it (its creator or an admin). */
export type Need = "view" | "edit" | "manage";

export type GrantLevel = "view" | "edit";

/** How an actor stands toward one row. */
export interface Access {
  kind: Kind;
  id: string;
  workspaceId: string;
  createdBy: string | null;
  /** Their role in the row's workspace (null: not a member). */
  role: TeamRole | null;
  /** The strongest grant that reaches the row (null: none, or not needed). */
  grant: GrantLevel | null;
  visible: boolean;
}

const READ_ONLY = "You can see this, but you can't change it here.";
const NOT_YOURS = "Only the person who made this, or an admin of its space, can do that.";
const PIN_MESSAGE = "This API token is pinned to another workspace.";

const isSystem = (a: Actor) => a.via === "system";
const marks = (n: number) => Array.from({ length: n }, () => "?").join(", ");

/** The person a row is stamped with: the actor, or the install owner for the server's own work. */
export const personOf = (a: Actor): string => (isSystem(a) ? INSTALL_OWNER_ID : a.userId);

// ---------------------------------------------------------------------------
// Workspaces

/** A workspace by id or slug. */
function workspaceIdOf(ref: string): string | null {
  return (db().prepare("SELECT id FROM workspaces WHERE id = ? OR slug = ? LIMIT 1").get(ref, ref) as { id: string } | undefined)?.id ?? null;
}

function ownerWorkspace(): string {
  return (db().prepare("SELECT personal_workspace_id AS w FROM users WHERE id = ?").get(INSTALL_OWNER_ID) as { w: string | null } | undefined)?.w ?? "w_owner";
}

/** The actor's own library (the install owner's for the server). Null for someone who has none. */
export function personalWorkspace(actor: Actor = currentActor()): string | null {
  if (isSystem(actor)) return ownerWorkspace();
  return (db().prepare("SELECT personal_workspace_id AS w FROM users WHERE id = ?").get(actor.userId) as { w: string | null } | undefined)?.w ?? null;
}

/** The actor's role in a workspace; a pinned token holds none outside its pin. */
export function roleIn(actor: Actor, workspaceId: string): TeamRole | null {
  if (isSystem(actor)) return "owner";
  if (actor.workspacePin && workspaceId !== actor.workspacePin) return null;
  return effectiveTeamRole(actor, workspaceId);
}

/** The workspaces whose rows the actor sees as a member: the pin alone for a pinned token. */
export function memberWorkspaces(actor: Actor = currentActor()): string[] {
  if (actor.workspacePin) return roleIn(actor, actor.workspacePin) ? [actor.workspacePin] : [];
  const rows = db().prepare("SELECT workspace_id AS w FROM workspace_members WHERE user_id = ? ORDER BY created_at, workspace_id").all(actor.userId) as { w: string }[];
  return rows.map((r) => r.w).filter((w) => roleIn(actor, w));
}

/** A workspace the actor asked for (id or slug), checked: a pinned token only gets its pin, others only their own. */
function askedWorkspace(actor: Actor, asked: string): string {
  const id = workspaceIdOf(asked);
  if (isSystem(actor)) {
    if (!id) throw new NotFoundError("That space doesn't exist.");
    return id;
  }
  if (actor.workspacePin && id !== actor.workspacePin) throw new ForbiddenError(PIN_MESSAGE, "WORKSPACE_PIN");
  if (!id || !roleIn(actor, id)) throw new NotFoundError("That space isn't one of yours.", true);
  return id;
}

/**
 * The workspace this request works in: the one it asked for (X-Fuobe-Workspace, `?workspace=`), else a pinned
 * token's pin, else the person's own library. New rows land here; lists show it unless they ask for another space.
 */
export function activeWorkspace(actor: Actor = currentActor()): string {
  const asked = requestScope()?.workspace?.trim();
  if (asked) return askedWorkspace(actor, asked);
  if (isSystem(actor)) return ownerWorkspace();
  if (actor.workspacePin) return actor.workspacePin;
  const own = personalWorkspace(actor);
  if (!own) throw new ForbiddenError("You don't have a library yet. Ask an admin.", "NO_WORKSPACE");
  return own;
}

/**
 * Whether a request asking for `asked` (a header or query value) contradicts the actor's token pin: handler()
 * answers 403 for it before the route runs.
 */
export function pinConflict(actor: Actor | null, asked: string | null | undefined): boolean {
  if (!actor?.workspacePin || !asked?.trim()) return false;
  return workspaceIdOf(asked.trim()) !== actor.workspacePin;
}

// ---------------------------------------------------------------------------
// Grants and containers

/** The ids of folders under these folders (themselves included), at any depth. */
function withSubfolders(ids: string[]): string[] {
  if (!ids.length) return [];
  const rows = db()
    .prepare(
      `WITH RECURSIVE tree(id) AS (SELECT id FROM folders WHERE id IN (${marks(ids.length)})
         UNION SELECT f.id FROM folders f JOIN tree ON f.parent_id = tree.id)
       SELECT id FROM tree`,
    )
    .all(...ids) as { id: string }[];
  return rows.map((r) => r.id);
}

/** A folder and the folders above it. */
function folderChain(folderId: string): string[] {
  const rows = db()
    .prepare(
      `WITH RECURSIVE up(id, parent) AS (SELECT id, parent_id FROM folders WHERE id = ?
         UNION SELECT f.id, f.parent_id FROM folders f JOIN up ON f.id = up.parent)
       SELECT id FROM up`,
    )
    .all(folderId) as { id: string }[];
  return rows.map((r) => r.id);
}

type Containers = (id: string) => { kind: Kind; id: string }[];

/** What holds a row, so a grant on the holder reaches it. Packages add theirs (a Cinema project holds its takes). */
const CONTAINERS: Map<Kind, Containers> = new Map<Kind, Containers>([
  [
    "generation",
    (id) => {
      const f = db().prepare("SELECT folder_id AS f FROM folder_items WHERE generation_id = ?").get(id) as { f: string } | undefined;
      return f ? folderChain(f.f).map((x) => ({ kind: "folder" as const, id: x })) : [];
    },
  ],
  ["folder", (id) => folderChain(id).filter((x) => x !== id).map((x) => ({ kind: "folder" as const, id: x }))],
  [
    "asset",
    (id): { kind: Kind; id: string }[] => {
      const g = db().prepare("SELECT generation_id AS g FROM assets WHERE id = ?").get(id) as { g: string | null } | undefined;
      return g?.g ? [{ kind: "generation" as const, id: g.g }, ...containersOf("generation", g.g)] : [];
    },
  ],
]);

export function registerContainers(kind: Kind, fn: Containers): void {
  CONTAINERS.set(kind, fn);
}

const containersOf = (kind: Kind, id: string): { kind: Kind; id: string }[] => CONTAINERS.get(kind)?.(id) ?? [];

/** Who a grant may name for this actor: themselves, and their workspaces (a pinned token: its pin only). */
function grantees(actor: Actor): { users: string[]; workspaces: string[] } {
  if (actor.workspacePin) return { users: [], workspaces: [actor.workspacePin] };
  return { users: [actor.userId], workspaces: memberWorkspaces(actor) };
}

const anyGrants = () => !!db().prepare("SELECT 1 FROM grants LIMIT 1").get();

/** The SQL that matches grants naming these grantees, with its arguments. */
function granteeSql(g: { users: string[]; workspaces: string[] }): { sql: string; args: string[] } | null {
  const parts: string[] = [];
  const args: string[] = [];
  if (g.users.length) {
    parts.push(`(grantee_kind = 'user' AND grantee_id IN (${marks(g.users.length)}))`);
    args.push(...g.users);
  }
  if (g.workspaces.length) {
    parts.push(`(grantee_kind = 'workspace' AND grantee_id IN (${marks(g.workspaces.length)}))`);
    args.push(...g.workspaces);
  }
  return parts.length ? { sql: `(${parts.join(" OR ")})`, args } : null;
}

/** The strongest grant on any of these targets for this actor. */
function grantLevel(actor: Actor, targets: { kind: Kind; id: string }[]): GrantLevel | null {
  if (!targets.length || !anyGrants()) return null;
  const who = granteeSql(grantees(actor));
  if (!who) return null;
  const rows = db()
    .prepare(`SELECT level FROM grants WHERE (${targets.map(() => "(resource_kind = ? AND resource_id = ?)").join(" OR ")}) AND ${who.sql}`)
    .all(...targets.flatMap((t) => [t.kind, t.id]), ...who.args) as { level: string }[];
  if (rows.some((r) => r.level === "edit")) return "edit";
  return rows.length ? "view" : null;
}

// ---------------------------------------------------------------------------
// One row

interface RowInfo {
  workspace_id: string;
  created_by: string | null;
}

function rowInfo(kind: Kind, id: string): RowInfo | null {
  return (db().prepare(`SELECT workspace_id, created_by FROM ${KINDS[kind]} WHERE id = ?`).get(id) as RowInfo | undefined) ?? null;
}

/** How the actor stands toward a row whose workspace and creator are known. */
export function accessTo(actor: Actor, kind: Kind, id: string, info: RowInfo): Access {
  const base = { kind, id, workspaceId: info.workspace_id, createdBy: info.created_by ?? null };
  if (isSystem(actor)) return { ...base, role: "owner", grant: null, visible: true };
  const role = roleIn(actor, info.workspace_id);
  const install = info.workspace_id === INSTALL_WORKSPACE;
  // A member needs no grant; anyone else may hold one on the row or what holds it.
  const grant = role && teamRoleAtLeast(role, "member") ? null : grantLevel(actor, [{ kind, id }, ...containersOf(kind, id)]);
  return { ...base, role, grant, visible: !!role || install || !!grant };
}

/** Whether an Access allows what an action needs. */
export function allows(actor: Actor, a: Access, need: Need): boolean {
  if (isSystem(actor)) return true;
  if (!a.visible) return false;
  if (need === "view") return true;
  // The install catalog is read by all; only the person who made a row there (a narrator sample) may tidy it away.
  if (a.workspaceId === INSTALL_WORKSPACE) return !!a.createdBy && a.createdBy === actor.userId;
  const editor = teamRoleAtLeast(a.role, "member");
  if (need === "edit") return editor || a.grant === "edit";
  return teamRoleAtLeast(a.role, "admin") || (editor && a.createdBy === actor.userId);
}

const refusal = (need: Need) => new ForbiddenError(need === "manage" ? NOT_YOURS : READ_ONLY, need === "manage" ? "NOT_CREATOR" : "READ_ONLY");

/**
 * One row the actor may act on, or a refusal: 404 when it doesn't exist or they can't see it (the second is audited
 * as denied.hidden), 403 when they can see it but the action needs more. `missing` is the 404's words.
 */
export function get(kind: Kind, id: string, need: Need = "view", opts: { missing?: string; actor?: Actor } = {}): Access {
  const actor = opts.actor ?? currentActor();
  const info = rowInfo(kind, id);
  if (!info) throw new NotFoundError(opts.missing ?? "Not found");
  const a = accessTo(actor, kind, id, info);
  if (!a.visible) throw new NotFoundError(opts.missing ?? "Not found", true);
  if (!allows(actor, a, need)) throw refusal(need);
  return a;
}

/** The workspace a row belongs to (null when there is no such row): children are made where their parent is. */
export function workspaceOf(kind: Kind, id: string | null | undefined): string | null {
  return id ? (rowInfo(kind, id)?.workspace_id ?? null) : null;
}

/** Whether the actor can see a row (no refusal, nothing audited): for choices, not for answers. */
export function canSee(kind: Kind, id: string, actor: Actor = currentActor()): boolean {
  const info = rowInfo(kind, id);
  return !!info && accessTo(actor, kind, id, info).visible;
}

/**
 * The ids among `ids` the actor may act on. Ids that don't exist, or that they can't see, are left out (the second
 * audited); when none is left the answer is 404, so a list of someone else's ids reads like a list of wrong ones. One
 * they can see but may not act on refuses the whole request (403), so nothing is half done.
 */
export function getMany(kind: Kind, ids: string[], need: Need = "view", opts: { missing?: string; actor?: Actor } = {}): string[] {
  const actor = opts.actor ?? currentActor();
  const list = [...new Set(ids)];
  if (!list.length) return [];
  const rows: (RowInfo & { id: string })[] = [];
  for (let i = 0; i < list.length; i += 500) {
    const part = list.slice(i, i + 500);
    rows.push(...(db().prepare(`SELECT id, workspace_id, created_by FROM ${KINDS[kind]} WHERE id IN (${marks(part.length)})`).all(...part) as (RowInfo & { id: string })[]));
  }
  const usable: string[] = [];
  let hidden = 0;
  for (const r of rows) {
    const a = accessTo(actor, kind, r.id, r);
    if (!a.visible) hidden++;
    else if (!allows(actor, a, need)) throw refusal(need);
    else usable.push(r.id);
  }
  if (!usable.length) throw new NotFoundError(opts.missing ?? "Not found", hidden > 0);
  if (hidden) auditHidden({ kind, id: null });
  // In the order asked for.
  const keep = new Set(usable);
  return list.filter((id) => keep.has(id));
}

/**
 * The ids among `ids` the actor may act on as `need`, quietly: for server code tidying its own rows (a studio
 * trashing the takes it replaced). Routes refuse first with getMany, which answers 404 and 403.
 */
export function usable(kind: Kind, ids: string[], need: Need = "view", actor: Actor = currentActor()): string[] {
  const list = [...new Set(ids)];
  if (!list.length) return [];
  const ok = new Set<string>();
  for (let i = 0; i < list.length; i += 500) {
    const part = list.slice(i, i + 500);
    const rows = db().prepare(`SELECT id, workspace_id, created_by FROM ${KINDS[kind]} WHERE id IN (${marks(part.length)})`).all(...part) as (RowInfo & { id: string })[];
    for (const r of rows) if (allows(actor, accessTo(actor, kind, r.id, r), need)) ok.add(r.id);
  }
  return list.filter((id) => ok.has(id));
}

// ---------------------------------------------------------------------------
// Lists

export interface ListScope {
  sql: string;
  args: unknown[];
}

export interface ListOptions {
  /**
   * The space to list: a workspace id or slug, "all" (everything the actor sees), or unset for the active workspace.
   */
  space?: string | null;
  /** Install catalog rows: the actor's own (a narrator sample they asked for, the default), all of them, or none. */
  install?: "own" | "all" | "none";
}

/**
 * A WHERE fragment that keeps the rows of `kind` (aliased `alias`) the actor sees in a space: the space's rows, rows
 * granted to it (and, in their own library, to them), and install catalog rows as asked. The server sees everything.
 */
export function list(kind: Kind, alias: string, opts: ListOptions = {}): ListScope {
  const actor = currentActor();
  const col = `${alias}.workspace_id`;
  const space = opts.space?.trim() || null;
  if (isSystem(actor)) return space && space !== "all" ? { sql: `${col} = ?`, args: [askedWorkspace(actor, space)] } : { sql: "1 = 1", args: [] };
  const all = space === "all";
  const spaces = all ? memberWorkspaces(actor) : [space ? askedWorkspace(actor, space) : activeWorkspace(actor)];
  const parts: string[] = [];
  const args: unknown[] = [];
  if (spaces.length) {
    parts.push(`${col} IN (${marks(spaces.length)})`);
    args.push(...spaces);
  }
  const install = opts.install ?? "own";
  if (install === "all") parts.push(`${col} = '${INSTALL_WORKSPACE}'`);
  else if (install === "own") {
    parts.push(`(${col} = '${INSTALL_WORKSPACE}' AND ${alias}.created_by = ?)`);
    args.push(actor.userId);
  }
  // Grants: to the space (to every space the actor is in, for "all"), and to the person in their own library.
  if (anyGrants()) {
    const own = !actor.workspacePin && (all || spaces[0] === personalWorkspace(actor));
    const who = granteeSql({ users: own ? [actor.userId] : [], workspaces: spaces });
    if (who) {
      const granted = (k: Kind) => `SELECT resource_id FROM grants WHERE resource_kind = '${k}' AND ${who.sql}`;
      parts.push(`${alias}.id IN (${granted(kind)})`);
      args.push(...who.args);
      // A shared folder reaches its subfolders and their results; a shared result reaches its files.
      const tree = kind === "generation" || kind === "folder" ? withSubfolders((db().prepare(granted("folder")).all(...who.args) as { resource_id: string }[]).map((r) => r.resource_id)) : [];
      if (tree.length) {
        parts.push(kind === "generation" ? `${alias}.id IN (SELECT generation_id FROM folder_items WHERE folder_id IN (${marks(tree.length)}))` : `${alias}.id IN (${marks(tree.length)})`);
        args.push(...tree);
      }
      if (kind === "asset") {
        parts.push(`${alias}.generation_id IN (${granted("generation")})`);
        args.push(...who.args);
      }
    }
  }
  return { sql: parts.length ? `(${parts.join(" OR ")})` : "0 = 1", args };
}

// ---------------------------------------------------------------------------
// New rows

export interface StampOptions {
  /** Where the row goes when the server chose it: a root's workspace, a project's, or the install catalog. */
  workspaceId?: string;
  /** A row that belongs to its author (a chat, a schedule): their own library (a pinned token's pin). */
  personal?: boolean;
}

export interface Stamp {
  workspace_id: string;
  created_by: string;
}

/**
 * The scoping columns of a row this request starts: the workspace it lands in and the person making it (who also
 * pays: callers copy created_by into paid_by where a row spends). The workspace is the active one unless the server
 * names another; making something there needs Editor or more (a viewer gets 403), and a pinned token can't write
 * outside its pin. Retries, Run again and every step a request starts are stamped with the person asking, never with
 * whoever made the original.
 */
export function stamp(opts: StampOptions = {}): Stamp {
  const actor = currentActor();
  const by = personOf(actor);
  if (opts.workspaceId === INSTALL_WORKSPACE) return { workspace_id: INSTALL_WORKSPACE, created_by: by };
  if (isSystem(actor)) return { workspace_id: opts.workspaceId ?? activeWorkspace(actor), created_by: by };
  if (opts.personal && !opts.workspaceId) {
    const ws = actor.workspacePin ?? personalWorkspace(actor);
    if (!ws) throw new ForbiddenError("You don't have a library yet. Ask an admin.", "NO_WORKSPACE");
    return { workspace_id: ws, created_by: by };
  }
  const ws = opts.workspaceId ?? activeWorkspace(actor);
  if (actor.workspacePin && ws !== actor.workspacePin) throw new ForbiddenError(PIN_MESSAGE, "WORKSPACE_PIN");
  if (!teamRoleAtLeast(roleIn(actor, ws), "member")) {
    throw new ForbiddenError("You can look around this space, but making things here needs Editor. Ask a team admin.", "VIEWER");
  }
  return { workspace_id: ws, created_by: by };
}

/**
 * INSERT a row object (its keys are its columns) stamped with stamp(opts): the studios' one way to add a scoped row,
 * so a new row always says where it belongs and who made it. Returns the stamp.
 */
export function insertStamped(table: string, row: object, opts: StampOptions = {}): Stamp {
  const s = stamp(opts);
  const full = { ...row, ...s } as Record<string, unknown>;
  const keys = Object.keys(full);
  db()
    .prepare(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map((k) => `@${k}`).join(", ")})`)
    .run(full);
  return s;
}

/**
 * Run `fn` working in `workspaceId` (one the server chose: a project's, a root's), so everything it starts — a chain's
 * steps, a batch's jobs — lands there and is checked there (Editor or more, as stamp() asks).
 */
export function inWorkspace<T>(workspaceId: string, fn: () => T): T {
  const scope = requestScope() ?? { actor: currentActor() };
  return withScope({ ...scope, workspace: workspaceId }, fn);
}

/**
 * Where a row started from an existing root goes (a chain step, a batch's next job, a retry of a step): the root's
 * workspace, only when the actor holds Editor or more there (403 otherwise). A root in the install catalog gives way
 * to the active workspace. The root must be one the actor can see (404 otherwise).
 */
export function rootWorkspace(kind: Kind, rootId: string): string {
  const actor = currentActor();
  const a = get(kind, rootId, "view", { actor });
  if (a.workspaceId === INSTALL_WORKSPACE) return activeWorkspace(actor);
  if (!isSystem(actor) && !teamRoleAtLeast(roleIn(actor, a.workspaceId), "member")) {
    throw new ForbiddenError("That was made in a space where you can't make things. Ask a team admin for Editor.", "ROOT_READ_ONLY");
  }
  return a.workspaceId;
}

// ---------------------------------------------------------------------------
// Files

/** The rel_path of a stored file an /api/files/ URL names, or null for anything else. */
function relPathOf(ref: string): string | null {
  if (!ref.startsWith("/api/files/")) return null;
  try {
    return decodeURIComponent(ref.slice("/api/files/".length).split("?")[0]).split("/").join(path.sep);
  } catch {
    return null;
  }
}

/**
 * Refuse a stored file the actor can't read: an asset id or an /api/files/ URL whose assets row (any row sharing
 * the file, they're counted by rel_path) isn't visible to them answers 404 (audited). Links elsewhere and data URIs
 * aren't Fuobe's files and pass.
 */
export function assertReadable(ref: string, actor: Actor = currentActor()): void {
  if (/^(https?:|data:)/i.test(ref)) return;
  const rel = relPathOf(ref);
  const rows = (
    rel ? db().prepare("SELECT id, workspace_id, created_by FROM assets WHERE rel_path = ?").all(rel) : db().prepare("SELECT id, workspace_id, created_by FROM assets WHERE id = ?").all(ref)
  ) as (RowInfo & { id: string })[];
  if (!rows.length) throw new NotFoundError("That file isn't there anymore.");
  if (!rows.some((r) => accessTo(actor, "asset", r.id, r).visible)) throw new NotFoundError("That file isn't there anymore.", true);
}
