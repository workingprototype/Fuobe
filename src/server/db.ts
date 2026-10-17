import "server-only";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.FUOBE_DATA_DIR ?? path.join(process.cwd(), "data"));

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS generations (
    id TEXT PRIMARY KEY,
    batch_id TEXT,
    feature TEXT NOT NULL,
    preset_id TEXT,
    model_id TEXT NOT NULL,
    engine TEXT NOT NULL,
    provider TEXT NOT NULL,
    op TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    progress REAL,
    message TEXT,
    prompt TEXT,
    request_json TEXT NOT NULL,
    provider_input_json TEXT,
    external_id TEXT,
    external_meta_json TEXT,
    outputs_json TEXT NOT NULL DEFAULT '[]',
    error TEXT,
    cost_usd REAL,
    favorite INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS generations_created ON generations(created_at DESC);
  CREATE INDEX IF NOT EXISTS generations_status ON generations(status);
  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT,
    rel_path TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    source TEXT NOT NULL,
    generation_id TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS assets_created ON assets(created_at DESC);
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    reference_asset_ids_json TEXT NOT NULL DEFAULT '[]',
    trigger_word TEXT,
    lora_file TEXT,
    status TEXT NOT NULL DEFAULT 'ready',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );`,
  // Characters become Elements (characters, locations, props, styles) with @handles and trained LoRAs.
  `ALTER TABLE characters ADD COLUMN kind TEXT NOT NULL DEFAULT 'character';
  ALTER TABLE characters ADD COLUMN handle TEXT;
  ALTER TABLE characters ADD COLUMN loras_json TEXT;`,
  // Identity training jobs (Soul ID, fal LoRA trainers, AI-Toolkit).
  `CREATE TABLE IF NOT EXISTS trainings (
    id TEXT PRIMARY KEY,
    element_id TEXT NOT NULL,
    target TEXT NOT NULL,
    provider TEXT NOT NULL,
    status TEXT NOT NULL,
    progress REAL,
    message TEXT,
    external_id TEXT,
    meta_json TEXT,
    trigger_word TEXT,
    error TEXT,
    cost_usd REAL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS trainings_element ON trainings(element_id);`,
  // Chained jobs (storyboard frames wait for the previous frame).
  `ALTER TABLE generations ADD COLUMN depends_on TEXT;`,
  // Assist chats: the model's message history, the transcript shown in the UI and a pending approval.
  `CREATE TABLE IF NOT EXISTS assist_threads (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    agent TEXT NOT NULL,
    engine TEXT NOT NULL,
    auto_approve INTEGER NOT NULL DEFAULT 0,
    messages_json TEXT NOT NULL DEFAULT '[]',
    items_json TEXT NOT NULL DEFAULT '[]',
    pending_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS assist_threads_updated ON assist_threads(updated_at DESC);`,
  // When each generation reached its provider (and when the provider started it): timeouts run from here, not from creation.
  `CREATE TABLE IF NOT EXISTS generation_runs (
    id TEXT PRIMARY KEY,
    submitted_at INTEGER NOT NULL,
    started_at INTEGER
  );`,
];

declare global {
  var __fuobeDb: Database.Database | undefined;
}

function open(): Database.Database {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(path.join(DATA_DIR, "fuobe.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY)`);
  const done = new Set(
    (db.prepare("SELECT id FROM _migrations").all() as { id: number }[]).map((r) => r.id),
  );
  MIGRATIONS.forEach((sql, i) => {
    if (done.has(i)) return;
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (id) VALUES (?)").run(i);
    })();
  });
  return db;
}

export function db(): Database.Database {
  globalThis.__fuobeDb ??= open();
  return globalThis.__fuobeDb;
}
