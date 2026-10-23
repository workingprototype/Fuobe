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
  // Library: Trash (soft delete, purged after 30 days) and folders (one folder per generation).
  `CREATE TABLE IF NOT EXISTS generation_trash (
    generation_id TEXT PRIMARY KEY,
    deleted_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS generation_trash_deleted ON generation_trash(deleted_at);
  CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS folder_items (
    generation_id TEXT PRIMARY KEY,
    folder_id TEXT NOT NULL,
    added_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS folder_items_folder ON folder_items(folder_id);`,
  // Cinema Studio: projects (Director settings, brief, AI Director chat), folders = scenes, and the generations in them.
  `CREATE TABLE IF NOT EXISTS cinema_projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    cover_url TEXT,
    cost_cap_usd REAL,
    director_json TEXT NOT NULL DEFAULT '{}',
    palettes_json TEXT NOT NULL DEFAULT '[]',
    brief_title TEXT NOT NULL DEFAULT '',
    brief_body TEXT NOT NULL DEFAULT '',
    chat_json TEXT NOT NULL DEFAULT '[]',
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cinema_folders (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    parent_id TEXT,
    name TEXT NOT NULL,
    color TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS cinema_folders_project ON cinema_folders(project_id);
  CREATE TABLE IF NOT EXISTS cinema_items (
    project_id TEXT NOT NULL,
    generation_id TEXT NOT NULL,
    folder_id TEXT,
    meta_json TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, generation_id)
  );
  CREATE INDEX IF NOT EXISTS cinema_items_generation ON cinema_items(generation_id);`,
  // Canvas boards: the node graph (edited by the user) and each generator node's last run (written by the server).
  `CREATE TABLE IF NOT EXISTS canvases (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    graph_json TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
    runs_json TEXT NOT NULL DEFAULT '{}',
    template_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    edited_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS canvases_updated ON canvases(updated_at DESC);`,
  // Layers projects: one source image, saved versions of its layer document, and the AI jobs its tools started.
  `CREATE TABLE IF NOT EXISTS layer_projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source_url TEXT NOT NULL,
    cover_url TEXT,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    head_version_id TEXT,
    jobs_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS layer_projects_updated ON layer_projects(updated_at DESC);
  CREATE TABLE IF NOT EXISTS layer_versions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    label TEXT NOT NULL,
    doc_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS layer_versions_project ON layer_versions(project_id, created_at DESC);`,
  // Shorts Studio: sessions (a clip cut into segments, each with its takes and the chosen one, plus the stitches) and custom presets.
  `CREATE TABLE IF NOT EXISTS shorts_sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    engine TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    look_json TEXT NOT NULL,
    source_json TEXT NOT NULL,
    range_json TEXT NOT NULL,
    settings_json TEXT NOT NULL,
    segments_json TEXT NOT NULL DEFAULT '[]',
    stitches_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS shorts_sessions_updated ON shorts_sessions(updated_at DESC);
  CREATE TABLE IF NOT EXISTS shorts_presets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    references_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );`,
  // Marketing: brand kits (researched or manual), products (shared by every marketing flow), Ads Studio runs and their
  // creatives, and Marketing Studio / Click to Ad / Ad Multiplier runs (a batch of chained generations plus what made it).
  `CREATE TABLE IF NOT EXISTS brand_kits (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    website TEXT,
    status TEXT NOT NULL DEFAULT 'ready',
    progress_json TEXT,
    kit_json TEXT NOT NULL DEFAULT '{}',
    chat_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS brand_kits_updated ON brand_kits(updated_at DESC);
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    brand_id TEXT,
    name TEXT NOT NULL,
    description TEXT,
    price REAL,
    currency TEXT,
    audience TEXT,
    selling_points_json TEXT NOT NULL DEFAULT '[]',
    url TEXT,
    images_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS products_brand ON products(brand_id, created_at);
  CREATE TABLE IF NOT EXISTS ad_batches (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL,
    engine TEXT NOT NULL,
    route TEXT NOT NULL,
    model_id TEXT NOT NULL,
    direction TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ad_batches_brand ON ad_batches(brand_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS ad_creatives (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL,
    brand_id TEXT NOT NULL,
    product_id TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    angle TEXT,
    headline TEXT,
    body TEXT,
    cta TEXT,
    visual TEXT,
    generation_id TEXT,
    layout TEXT,
    meta_json TEXT,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ad_creatives_brand ON ad_creatives(brand_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS ad_creatives_batch ON ad_creatives(batch_id);
  CREATE INDEX IF NOT EXISTS ad_creatives_generation ON ad_creatives(generation_id);
  CREATE TABLE IF NOT EXISTS marketing_runs (
    id TEXT PRIMARY KEY,
    feature TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    final_ids_json TEXT NOT NULL DEFAULT '[]',
    engine TEXT NOT NULL,
    title TEXT NOT NULL,
    meta_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS marketing_runs_feature ON marketing_runs(feature, created_at DESC);`,
  // Image studios: colour signatures (Soul HEX; the 50 Cinema Studio palettes are seeded on first use), moodboards
  // (reference sets with their cover job, Recraft style id and optional style LoRA element) and Instadump user packs.
  `CREATE TABLE IF NOT EXISTS palettes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    colors_json TEXT NOT NULL,
    background TEXT,
    slug TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    thumb_url TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS palettes_source ON palettes(source, created_at DESC);
  CREATE TABLE IF NOT EXISTS moodboards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    images_json TEXT NOT NULL,
    collages_json TEXT NOT NULL DEFAULT '[]',
    engine TEXT NOT NULL,
    generation_id TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    cover_url TEXT,
    style_id TEXT,
    element_id TEXT,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS moodboards_created ON moodboards(created_at DESC);
  CREATE TABLE IF NOT EXISTS photodump_packs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    refs_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );`,
  // Faceless Studio channels (genre, saved style / voice / aspect / subtitles, the avatar being drawn) and episodes (Faceless and Explainer: script, render plan).
  `CREATE TABLE IF NOT EXISTS faceless_channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    idea TEXT NOT NULL,
    genre TEXT NOT NULL,
    avatar_url TEXT,
    avatar_job TEXT,
    reference_json TEXT,
    settings_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS faceless_channels_updated ON faceless_channels(updated_at DESC);
  CREATE TABLE IF NOT EXISTS faceless_episodes (
    id TEXT PRIMARY KEY,
    channel_id TEXT,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    topic TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    settings_json TEXT NOT NULL,
    script_json TEXT NOT NULL,
    plan_json TEXT,
    sources_json TEXT,
    favorite INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS faceless_episodes_channel ON faceless_episodes(channel_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS faceless_episodes_kind ON faceless_episodes(kind, created_at DESC);`,
  // Translate & dub sessions and Katana jobs (av-tools): what the person asked for and the generation ids of each step.
  `CREATE TABLE IF NOT EXISTS dub_sessions (
    id TEXT PRIMARY KEY,
    data_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS dub_sessions_updated ON dub_sessions(updated_at DESC);
  CREATE TABLE IF NOT EXISTS katana_jobs (
    id TEXT PRIMARY KEY,
    data_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS katana_jobs_updated ON katana_jobs(updated_at DESC);`,
  // Assist (assist-skills): user skills and built-in toggles, projects with their sources, typed
  // memories, and per-chat state (project, mode, loaded skills, the context the model was given).
  `CREATE TABLE IF NOT EXISTS skills (
    name TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    when_to_use TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    meta_json TEXT NOT NULL DEFAULT '{}',
    files_json TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS skill_toggles (name TEXT PRIMARY KEY, enabled INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS assist_projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT 'iris',
    instructions TEXT NOT NULL DEFAULT '',
    skills_json TEXT NOT NULL DEFAULT '[]',
    use_personal_memory INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS assist_project_sources (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT,
    element_id TEXT,
    content TEXT,
    status TEXT NOT NULL DEFAULT 'ready',
    error TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS assist_project_sources_project ON assist_project_sources(project_id, created_at);
  CREATE TABLE IF NOT EXISTS assist_memory (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL DEFAULT 'personal',
    project_id TEXT,
    category TEXT NOT NULL,
    text TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'user',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS assist_memory_scope ON assist_memory(scope, project_id, updated_at DESC);
  CREATE TABLE IF NOT EXISTS assist_thread_state (
    thread_id TEXT PRIMARY KEY,
    project_id TEXT,
    mode TEXT,
    model TEXT,
    effort TEXT,
    skills_json TEXT NOT NULL DEFAULT '[]',
    context TEXT,
    sent_json TEXT
  );
  CREATE INDEX IF NOT EXISTS assist_thread_state_project ON assist_thread_state(project_id);`,
  // round 4 (r4/library-plus): nested library folders (a parent), pins on folders and results, and a review status on results.
  `ALTER TABLE folders ADD COLUMN parent_id TEXT;
  ALTER TABLE folders ADD COLUMN pinned_at INTEGER;
  CREATE INDEX IF NOT EXISTS folders_parent ON folders(parent_id);
  ALTER TABLE generations ADD COLUMN pinned_at INTEGER;
  ALTER TABLE generations ADD COLUMN review TEXT;
  CREATE INDEX IF NOT EXISTS generations_pinned ON generations(pinned_at) WHERE pinned_at IS NOT NULL;`,
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
