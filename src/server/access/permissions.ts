import "server-only";
import { db } from "../db";
import { runAs, type Actor } from "./actor";

/**
 * Roles and permissions (docs/research/accounts-8.md §7.3). Both are registries: the core registers the install roles
 * owner, admin and member and the core permissions; later packages add theirs (the audit viewer adds `auditor` and
 * `audit.view` holders, the Platform admin adds `billing`, `moderator` and `support` with `billing.*` and
 * `moderation.*`). Routes declare the permission they need (`handler({ access: "perm:install.settings" })`) and never
 * test a role name themselves.
 *
 * Team roles (owner, admin, member shown as Editor, viewer) are answered by effectiveTeamRole() alone, so the clamps
 * that come later (view-only seats, view-as) apply everywhere at once.
 */

// ---------------------------------------------------------------------------
// Permissions

const PERMISSIONS = new Set<string>([
  "install.settings",
  "install.mode",
  "people.view",
  "people.manage",
  "people.roles",
  "usage.view_all",
  "limits.manage",
  "keys.install",
  "teams.create",
  "teams.manage_all",
  "audit.view",
  "data.manage",
  "gpu.manage",
  "approvals.decide",
  "support.view_as",
  "credits.adjust",
]);

/** Add a permission (a package's own: `billing.refund`, `moderation.review`…). */
export function registerPermission(name: string): void {
  PERMISSIONS.add(name);
}

export const permissionExists = (name: string): boolean => PERMISSIONS.has(name);

export function permissions(): string[] {
  return [...PERMISSIONS];
}

// ---------------------------------------------------------------------------
// Install roles

export interface RoleDef {
  /** Shown in people lists and pickers. */
  label: string;
  /** Higher outranks lower: who may act on whom (§7.3 target matrix) compares ranks. */
  rank: number;
  /** Permissions held: exact names, a family (`billing.*`) or everything (`*`). */
  grants: string[];
}

const ROLES = new Map<string, RoleDef>([
  ["owner", { label: "Owner", rank: 100, grants: ["*"] }],
  [
    "admin",
    {
      label: "Admin",
      rank: 50,
      // Everything an install needs run day to day; the mode, roles, view-as and credit adjustments stay with the owner.
      grants: [
        "install.settings",
        "people.view",
        "people.manage",
        "usage.view_all",
        "limits.manage",
        "keys.install",
        "teams.create",
        "teams.manage_all",
        "audit.view",
        "data.manage",
        "gpu.manage",
        "approvals.decide",
      ],
    },
  ],
  // Whether members may create teams is an install setting (teams.create), refined by the teams package.
  ["member", { label: "Member", rank: 10, grants: [] }],
]);

/** Add or replace an install role (`auditor`, `billing`, `moderator`, `support`). `owner` is fixed. */
export function registerRole(name: string, def: RoleDef): void {
  if (name === "owner") throw new Error("The owner role is fixed");
  ROLES.set(name, def);
}

export const roleExists = (name: string): boolean => ROLES.has(name);
export const roleDef = (name: string): RoleDef | undefined => ROLES.get(name);

export function roles(): { name: string; def: RoleDef }[] {
  return [...ROLES].map(([name, def]) => ({ name, def })).sort((a, b) => b.def.rank - a.def.rank);
}

const grantCovers = (grant: string, permission: string) =>
  grant === "*" || grant === permission || (grant.endsWith(".*") && permission.startsWith(grant.slice(0, -1)));

/** Whether an install role holds a permission. Unknown roles hold nothing. */
export function roleCan(role: string, permission: string): boolean {
  return (ROLES.get(role)?.grants ?? []).some((g) => grantCovers(g, permission));
}

/**
 * Whether the actor may do something that needs `permission`. The server itself (asSystem) may; a view-as session
 * may not (it is read-only, §9.5 E5b); a token needs the admin or full scope for any install permission.
 */
export function can(actor: Actor | null | undefined, permission: string): boolean {
  if (!actor) return false;
  if (actor.via === "system") return true;
  if (actor.impersonatorId) return false;
  if (actor.via === "token" && !actor.scopes.some((s) => s === "full" || s === "admin")) return false;
  return roleCan(actor.role, permission);
}

// ---------------------------------------------------------------------------
// Team roles

export type TeamRole = "owner" | "admin" | "member" | "viewer";

/** Strongest first. `member` is shown as "Editor". */
export const TEAM_ROLES: readonly TeamRole[] = ["owner", "admin", "member", "viewer"];
export const TEAM_ROLE_LABEL: Record<TeamRole, string> = { owner: "Owner", admin: "Admin", member: "Editor", viewer: "Viewer" };

const teamRank = (r: TeamRole) => TEAM_ROLES.length - TEAM_ROLES.indexOf(r);

/** Whether `role` is at least `min` (an Editor action needs "member"). */
export function teamRoleAtLeast(role: TeamRole | null | undefined, min: TeamRole): boolean {
  return !!role && teamRank(role) >= teamRank(min);
}

/**
 * Clamps applied after the stored membership, in order: each may lower the role (a view-only seat is a Viewer,
 * §9.5 E6), never raise it. Packages register theirs.
 */
export type TeamRoleClamp = (actor: Actor, workspaceId: string, role: TeamRole) => TeamRole;
const CLAMPS: TeamRoleClamp[] = [
  // View-as is read-only (§9.5 E5b): whoever is looking can't change anything.
  (actor, _w, role) => (actor.impersonatorId ? "viewer" : role),
];

export function registerTeamRoleClamp(clamp: TeamRoleClamp): void {
  CLAMPS.push(clamp);
}

/**
 * The actor's role in a workspace (their personal one, a team, or the install catalog), or null when they aren't a
 * member. The only function that answers a team role.
 */
export function effectiveTeamRole(actor: Actor, workspaceId: string): TeamRole | null {
  if (actor.via === "system") return "owner";
  const row = db().prepare("SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?").get(workspaceId, actor.userId) as { role: string } | undefined;
  if (!row || !(TEAM_ROLES as readonly string[]).includes(row.role)) return null;
  let role = row.role as TeamRole;
  for (const clamp of CLAMPS) {
    const next = clamp(actor, workspaceId, role);
    // A clamp only ever lowers.
    if (teamRank(next) < teamRank(role)) role = next;
  }
  return role;
}

// ---------------------------------------------------------------------------
// Acting for a row's owner

/** The words a runner fails a row with when the person who started it was turned off (§7.11). */
export const ACCOUNT_OFF_MESSAGE = "Paused: the account that started this is off.";

export class AccountOffError extends Error {
  constructor() {
    super(ACCOUNT_OFF_MESSAGE);
    this.name = "AccountOffError";
  }
}

/** The person every row belongs to until rows record who made them (the scoping package adds created_by). */
export const INSTALL_OWNER_ID = "u_owner";

/** Who started a stored row: its created_by once rows have one, else the install owner (everything is theirs today). */
export function rowOwner(row: object): string {
  return (row as { created_by?: string | null }).created_by || INSTALL_OWNER_ID;
}

/**
 * The actor a runner works as for a row started by `userId` (the install owner when the row names nobody yet). Throws
 * AccountOffError when that person is pending, turned off, deleted or dormant.
 */
export function ownerActor(userId?: string | null): Actor {
  const id = userId || INSTALL_OWNER_ID;
  const p = db().prepare("SELECT id, role, status, dormant FROM users WHERE id = ?").get(id) as { id: string; role: string; status: string; dormant: number } | undefined;
  if (!p || p.status !== "active" || p.dormant) throw new AccountOffError();
  return { userId: p.id, role: p.role, via: "runner", scopes: ["full"] };
}

/** Run `fn` as the row's owner (see ownerActor). */
export function runAsOwner<T>(userId: string | null | undefined, fn: () => T): T {
  return runAs(ownerActor(userId), fn);
}
