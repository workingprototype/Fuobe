/**
 * Every table and every area of the data folder, classified by who it belongs to (docs/research/accounts-8.md §7.4).
 * The scoping layer (src/server/access/scope.ts) reads this, and tests/table-classification.test.ts fails when the
 * database has a table, or the code a data-folder area, that isn't listed here: a new table has to say whose rows
 * it holds before it ships.
 *
 * - `workspace`: each row has workspace_id and created_by (a NULL workspace_id is refused by a trigger). Visible to
 *   members of that workspace, to grantees, and to everyone when it is the install catalog (`w_install`).
 * - `child`: follows `parent` (deleted, moved and shown with it); no workspace of its own.
 * - `user`: belongs to one person (`owner` names the column); `workspace` when it also records the workspace it
 *   was made in (a chat inside a team project stays its author's).
 * - `install`: install-wide (settings, caches): admins and the server, never a person's content.
 * - `identity`: people, workspaces, memberships, grants, marks, tokens, the audit log and Better Auth's tables.
 *
 * Pure data: no database access, so tests and the migration's own checks can read it anywhere.
 */

export type TableScope = "workspace" | "child" | "user" | "install" | "identity";

export interface TableClass {
  scope: TableScope;
  /** For a child: the table it follows. */
  parent?: string;
  /** For a user table: the column naming the person. */
  owner?: string;
  /** A user table that also records a workspace (and refuses a NULL one). */
  workspace?: boolean;
  /** Why, in a few words, where the rule isn't obvious. */
  note?: string;
}

export const TABLES: Record<string, TableClass> = {
  // The Library
  generations: { scope: "workspace", note: "created_by and paid_by are the acting person; favorites and pins in item_marks" },
  assets: { scope: "workspace", note: "uploads belong to the uploader's workspace; outputs follow their generation" },
  folders: { scope: "workspace", note: "a folder, its subfolders and their results share one workspace" },
  folder_items: { scope: "child", parent: "generations" },
  generation_trash: { scope: "child", parent: "generations", note: "Trash per workspace; trashed_by" },
  generation_runs: { scope: "child", parent: "generations" },
  // Elements and training
  characters: { scope: "workspace" },
  trainings: { scope: "child", parent: "characters", note: "started_by and paid_by" },
  // Studios
  cinema_projects: { scope: "workspace" },
  cinema_folders: { scope: "child", parent: "cinema_projects" },
  cinema_items: { scope: "child", parent: "cinema_projects" },
  canvases: { scope: "workspace" },
  layer_projects: { scope: "workspace" },
  layer_versions: { scope: "child", parent: "layer_projects" },
  shorts_sessions: { scope: "workspace" },
  shorts_presets: { scope: "workspace" },
  brand_kits: { scope: "workspace" },
  products: { scope: "workspace", note: "follow their brand kit; loose products own themselves" },
  ad_batches: { scope: "child", parent: "brand_kits" },
  ad_creatives: { scope: "child", parent: "ad_batches" },
  marketing_runs: { scope: "workspace" },
  palettes: { scope: "workspace", note: "built-ins in w_install: read by all, written by none" },
  moodboards: { scope: "workspace" },
  photodump_packs: { scope: "workspace" },
  faceless_channels: { scope: "workspace" },
  faceless_episodes: { scope: "workspace", note: "follow their channel; Explainers own themselves" },
  content_series: { scope: "workspace" },
  dub_sessions: { scope: "workspace" },
  katana_jobs: { scope: "workspace" },
  swap_projects: { scope: "workspace" },
  // Assist
  skills: { scope: "workspace", note: "keyed (workspace_id, name)" },
  skill_toggles: { scope: "user", owner: "user_id" },
  assist_threads: { scope: "user", owner: "user_id", workspace: true, note: "only the author sees a chat" },
  assist_thread_state: { scope: "child", parent: "assist_threads" },
  assist_projects: { scope: "workspace" },
  assist_project_sources: { scope: "child", parent: "assist_projects" },
  assist_memory: { scope: "user", owner: "user_id", note: "project rows follow their project" },
  assist_schedules: { scope: "user", owner: "user_id", workspace: true, note: "run as their owner" },
  assist_connectors: { scope: "user", owner: "owner_id" },
  // Sharing
  shares: { scope: "workspace", note: "a person's link to workspace content" },
  // Install
  settings: { scope: "install" },
  lora_mirrors: { scope: "install", note: "a cache of LoRA copies" },
  _migrations: { scope: "install" },
  // Identity (accounts, part 1)
  users: { scope: "identity" },
  workspaces: { scope: "identity" },
  workspace_members: { scope: "identity" },
  invites: { scope: "identity" },
  grants: { scope: "identity" },
  item_marks: { scope: "identity", note: "per viewer: favorites and pins" },
  api_tokens: { scope: "identity" },
  audit_log: { scope: "identity" },
  user_settings: { scope: "identity" },
  workspace_settings: { scope: "identity" },
  session_step_up: { scope: "identity" },
  auth_user: { scope: "identity", note: "Better Auth" },
  auth_account: { scope: "identity", note: "Better Auth" },
  auth_session: { scope: "identity", note: "Better Auth" },
  auth_verification: { scope: "identity", note: "Better Auth" },
  auth_rate_limit: { scope: "identity", note: "Better Auth" },
};

/** Tables whose rows carry a workspace_id (and a trigger refusing a NULL one). */
export const WORKSPACE_TABLES = Object.entries(TABLES)
  .filter(([, c]) => c.scope === "workspace" || c.workspace)
  .map(([t]) => t);

export type FileAreaScope = "workspace" | "element" | "install" | "scratch";

export interface FileArea {
  scope: FileAreaScope;
  rule: string;
}

/** Each top-level entry of the data folder (FUOBE_DATA_DIR). */
export const FILE_AREAS: Record<string, FileArea> = {
  files: { scope: "workspace", rule: "served by /api/files to whoever can see an assets row with that rel_path" },
  loras: { scope: "element", rule: "trained LoRA files follow their element" },
  datasets: { scope: "element", rule: "training photos follow their element, deleted with it" },
  tmp: { scope: "scratch", rule: "files being made; never served" },
  backups: { scope: "install", rule: "snapshots; never served" },
  "fuobe.db": { scope: "install", rule: "never served" },
  "auth.json": { scope: "install", rule: "legacy password and tokens; never served" },
  "secret.key": { scope: "install", rule: "the root secret; never served" },
};
