import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Build plan O7: Fuobe calls no Higgsfield API. This file fails when a code path names that provider again (its id,
 * key, endpoints, settings, env vars or copy that offers it), when a retired model comes back into the catalog, or
 * when an id stored before the switch no longer resolves to the model that replaced it. It scans whole folders, so a
 * branch merged later (an Originals package, a studio) is caught too. Research files under docs/research/ stay as
 * research and are not scanned; this file is the one test that names the provider.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-no-hf-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { MODELS, getModel } = await import("@/lib/catalog");
const { enginesOf } = await import("@/lib/catalog/engines");
const { REPLACED_BY, TRAINING_REPLACED_BY, currentModelId, migrateRequest, replacedBy } = await import("@/lib/catalog/replaced");
const { TRAINING_TARGETS } = await import("@/lib/catalog/training");
const { SOUL_LEGACY_IDS } = await import("@/lib/catalog/soul-looks.generated");
const { PROVIDER_SETTINGS } = await import("@/lib/connections");
const { PROVIDERS, provider, RETIRED_PROVIDER_ERROR } = await import("@/server/providers");
const { SETTINGS, getSetting } = await import("@/server/settings");
const { db } = await import("@/server/db");
const { withCurrentModels } = await import("@/lib/catalog/canvas");
const generationsRoute = await import("@/app/api/generations/route");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// The guard: no code path names the provider

/** Where code and shipped content live (docs/ holds the research, which stays). */
const SCANNED = ["src", "scripts", "bin", "skills", "workflows", "package.json"];
const TEXT = /\.(ts|tsx|mts|js|mjs|cjs|py|json|md|sh|bat|ps1|css|html|txt|yml|yaml)$/;

/**
 * Files that must name it, and why. Nothing else may: add a line here only for history that has to read the old
 * name (a migration, the table of what replaced what), never for a route, a key or a model that runs.
 */
const ALLOWED: Record<string, string> = {
  "src/server/db.ts": "the O7 migration deletes the retired key and rewrites stored values that name the provider",
  "src/lib/catalog/replaced.ts": "what each retired model was called, for history",
};

/** Research files and research record fields keep their names: reading research is not calling the provider. */
const RESEARCH_NAMES = /higgsfield-[a-z0-9-]+\.(md|json)|higgsfieldEquivalent/g;

const RULES: [string, RegExp][] = [
  // An id, key, endpoint, URL, import or settings key: always lowercase in code.
  ["names the provider in code (an id, key, endpoint, URL or import)", /higgsfield/],
  ["names a Higgsfield env var or constant", /HIGGSFIELD|\bHF_(API_)?(KEY|SECRET)\b/],
  // Copy that offers the provider: "Higgsfield key", "connect Higgsfield", "runs on Higgsfield", "Higgsfield Ads Studio"…
  [
    "offers the provider in copy",
    // ("as on Higgsfield" and "Higgsfield's old style ids" are comparisons and history, not an offer.)
    /higgsfield (api|key|account|balance|route|provider|credit|console)|(needs|with|connect|add|set) (a |an |your )?higgsfield(?!'s)\b|(?<!as )\b(on|via|through) higgsfield\b|higgsfield's (api|own models?|route|key)|higgsfield (soul|cinema studio|ads studio|marketing studio)/i,
  ],
];

function walk(p: string, out: string[]) {
  const full = path.join(ROOT, p);
  if (!fs.existsSync(full)) return;
  const st = fs.statSync(full);
  if (st.isFile()) {
    if (TEXT.test(p)) out.push(p);
    return;
  }
  for (const name of fs.readdirSync(full)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    walk(path.join(p, name), out);
  }
}

describe("no code path names the Higgsfield provider", () => {
  const files: string[] = [];
  for (const p of SCANNED) walk(p, files);

  it("scans every source, script, skill and workflow file", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain("src/server/providers/index.ts");
  });

  it("finds no provider id, key, endpoint, env var or copy that offers it outside the allowed history", () => {
    const hits: string[] = [];
    for (const f of files) {
      if (ALLOWED[f]) continue;
      const lines = fs.readFileSync(path.join(ROOT, f), "utf8").split("\n");
      lines.forEach((line, i) => {
        const text = line.replace(RESEARCH_NAMES, "");
        for (const [why, re] of RULES) if (re.test(text)) hits.push(`${f}:${i + 1} ${why}: ${line.trim().slice(0, 140)}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("has no file named after it", () => {
    expect(files.filter((f) => /higgsfield/i.test(path.basename(f)))).toEqual([]);
  });

  it("keeps the allowed history short and real", () => {
    for (const f of Object.keys(ALLOWED)) expect(fs.readFileSync(path.join(ROOT, f), "utf8"), f).toMatch(/higgsfield/i);
  });
});

// ---------------------------------------------------------------------------
// The catalog, the providers and the settings

describe("the catalog and the providers run without it", () => {
  const KNOWN = new Set(["fal", "replicate", "comfyui", "mock", "local", "llm", "openai", "google"]);

  it("routes every model to a provider Fuobe has", () => {
    const odd = MODELS.flatMap((m) => m.routes.filter((r) => !KNOWN.has(r.provider) || /higgsfield/i.test(r.endpoint)).map((r) => `${m.id}: ${r.provider} ${r.endpoint}`));
    expect(odd).toEqual([]);
    expect(Object.keys(PROVIDERS).sort()).toEqual([...KNOWN].sort());
  });

  it("has no setting, connection test or env var for it", () => {
    const named = Object.entries(SETTINGS).filter(([name, def]) => /higgsfield|^hf/i.test(`${name} ${def.key} ${"env" in def ? def.env : ""}`));
    expect(named).toEqual([]);
    expect(Object.keys(PROVIDER_SETTINGS)).not.toContain("higgsfield");
    expect(SETTINGS.cloudProvider.options).toEqual(["auto", "fal", "replicate"]);
  });

  it("fails a job stored under a provider Fuobe no longer has, with a way forward, instead of throwing", async () => {
    const gone = provider("higgsfield" as never);
    expect(gone.isConfigured()).toBe(false);
    const ctx = { externalId: "x", meta: {}, route: { op: "t2i" as const, provider: "fal" as const, endpoint: "x" }, model: getModel("nano-banana-pro")!, createdAt: 0 };
    await expect(gone.poll(ctx)).resolves.toEqual({ state: "failed", error: RETIRED_PROVIDER_ERROR });
    await expect(gone.cancel!(ctx)).resolves.toBeUndefined();
    expect(RETIRED_PROVIDER_ERROR).toMatch(/run it again/);
  });

  it("closes the partner gaps on fal: Happy Horse 1.1 runs there", () => {
    const hh = getModel("happy-horse-1-1")!;
    expect(hh.routes.map((r) => [r.op, r.provider, r.endpoint])).toEqual([
      ["t2v", "fal", "alibaba/happy-horse/v1.1/text-to-video"],
      ["i2v", "fal", "alibaba/happy-horse/v1.1/image-to-video"],
      ["ref2v", "fal", "alibaba/happy-horse/v1.1/reference-to-video"],
    ]);
    expect(hh.pricing).toMatchObject({ unit: "second", usd: 0.14, byResolution: { "720p": 0.14, "1080p": 0.18 } });
  });
});

// ---------------------------------------------------------------------------
// What replaced each retired item

describe("REPLACED_BY", () => {
  /** Every model the deleted catalog had, and the AI Influencer sheet defined beside it. */
  const RETIRED = [
    "soul-1",
    "soul-2",
    "soul-cinema",
    "cinema-studio-4",
    "genjutsu-motion-transfer",
    "genjutsu-lite-motion-transfer",
    "genjutsu-object-swap",
    "genjutsu-lite-object-swap",
    "genjutsu-restyle",
    "marketing-studio-image",
    "ads-studio",
    "ai-influencer",
  ];

  it("covers every retired model, none of which is in the catalog any more", () => {
    expect(Object.keys(REPLACED_BY).sort()).toEqual([...RETIRED].sort());
    for (const id of RETIRED) expect(getModel(id), id).toBeUndefined();
  });

  it("points each at a model that exists and isn't retired; an Original runs on both engines", () => {
    for (const [id, r] of Object.entries(REPLACED_BY)) {
      const m = getModel(r.id);
      expect(m, `${id} → ${r.id}`).toBeDefined();
      expect(replacedBy(r.id), r.id).toBeUndefined();
      if (r.original) expect(enginesOf(m!).sort(), r.id).toEqual(["cloud", "open"]);
      else expect(enginesOf(m!), r.id).toContain("cloud");
      expect(r.note.length, id).toBeGreaterThan(10);
    }
    expect(currentModelId("soul-2")).toBe("fuobe-soul");
    expect(currentModelId("nano-banana-pro")).toBe("nano-banana-pro");
  });

  it("points the old Soul ID targets at a trainer Fuobe has", () => {
    for (const [id, r] of Object.entries(TRAINING_REPLACED_BY)) {
      expect(TRAINING_TARGETS.some((t) => t.id === id), id).toBe(false);
      expect(TRAINING_TARGETS.some((t) => t.id === r.id), r.id).toBe(true);
    }
  });

  it("moves a stored request to its replacement: a Soul style becomes its look, the retired API's settings go", () => {
    const style = Object.entries(SOUL_LEGACY_IDS).find(([, look]) => look === "v2-general")![0];
    const old = { feature: "image", modelId: "soul-2", prompt: "a rooftop party", params: { aspectRatio: "3:4", extra: { style_id: style, custom_reference_id: "ref-1", custom_reference_strength: 0.8, seed: 7 } } };
    const { request, note } = migrateRequest(old);
    expect(request).toEqual({ feature: "image", modelId: "fuobe-soul", engine: "cloud", presetId: "v2-general", prompt: "a rooftop party", params: { aspectRatio: "3:4", extra: { seed: 7 } } });
    expect(note).toMatch(/Fuobe Soul/);
    // An engine asked for stays; a partner replacement gets none.
    expect(migrateRequest({ ...old, engine: "open" as const }).request.engine).toBe("open");
    expect(migrateRequest({ modelId: "marketing-studio-image", params: { extra: { template_id: "t" } } }).request).toEqual({ modelId: "gpt-image-2-5", params: {} });
    // A current model's request comes back as it was.
    const current = { modelId: "nano-banana-pro", params: { extra: { style_id: "x" } } };
    expect(migrateRequest(current)).toEqual({ request: current });
  });
});

describe("stored ids resolve where they are read", () => {
  it("runs a generation asked for on a retired model on its replacement, and says so (Reuse, CLI, MCP)", async () => {
    const res = await generationsRoute.POST(
      new Request("http://x/api/generations?preview=1", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ feature: "image", modelId: "soul-2", prompt: "a fox" }) }),
    );
    const body = (await res.json()) as { modelId: string; engine: string; notes?: string[]; error?: string };
    expect(body.error).toBeUndefined();
    expect(body).toMatchObject({ modelId: "fuobe-soul", engine: "cloud" });
    expect(body.notes?.[0]).toMatch(/Fuobe Soul/);
  });

  it("moves a saved Canvas node on a retired model to its replacement, in the cloud", () => {
    const graph = {
      nodes: [
        { id: "a", type: "model" as const, position: { x: 0, y: 0 }, data: { modelId: "cinema-studio-4", mediaKind: "video" as const, params: { aspectRatio: "16:9", extra: { color_palette: "static-noon" } } } },
        { id: "b", type: "model" as const, position: { x: 0, y: 0 }, data: { modelId: "nano-banana-pro", mediaKind: "image" as const } },
      ],
      edges: [],
    };
    const moved = withCurrentModels(graph);
    expect(moved.nodes[0].data).toMatchObject({ modelId: "fuobe-cinema", engine: "cloud", params: { aspectRatio: "16:9" } });
    expect(moved.nodes[0].data.params?.extra).toBeUndefined();
    expect(moved.nodes[1]).toBe(graph.nodes[1]);
    // A board with nothing retired comes back as it was.
    expect(withCurrentModels(moved)).toBe(moved);
  });
});

// ---------------------------------------------------------------------------
// The one migration

describe("the O7 migration", () => {
  it("deletes the retired key, resets the provider choice and marks the ads drawn whole as baked", () => {
    const d = db();
    const last = (d.prepare("SELECT MAX(id) AS id FROM _migrations").get() as { id: number }).id;
    // An install from before: rows the migration rewrites, then the migration runs again on the next open.
    d.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('higgsfield.key', 'id:secret'), ('cloud.provider', 'higgsfield')").run();
    d.prepare("INSERT INTO ad_batches (id, brand_id, engine, route, model_id, created_at) VALUES ('b1', 'br', 'cloud', 'higgsfield', 'ads-studio', 1), ('b2', 'br', 'cloud', 'fuobe', 'nano-banana-pro', 2)").run();
    d.prepare(
      `INSERT INTO ad_creatives (id, batch_id, brand_id, position, status, meta_json, created_at, updated_at) VALUES
       ('c1', 'b1', 'br', 0, 'queued', '{"engine":"cloud","modelId":"ads-studio","route":"higgsfield","ratio":"9:16"}', 1, 1),
       ('c2', 'b2', 'br', 0, 'queued', '{"engine":"cloud","modelId":"nano-banana-pro","route":"fuobe"}', 2, 2),
       ('c3', 'b2', 'br', 1, 'failed', 'not json', 3, 3)`,
    ).run();
    d.prepare("DELETE FROM _migrations WHERE id = ?").run(last);
    d.close();
    globalThis.__fuobeDb = undefined;

    const again = db();
    expect(again.prepare("SELECT value FROM settings WHERE key = 'higgsfield.key'").get()).toBeUndefined();
    expect(getSetting("cloudProvider")).toBe("auto");
    expect(again.prepare("SELECT route FROM ad_batches ORDER BY id").all()).toEqual([{ route: "baked" }, { route: "fuobe" }]);
    const meta = (id: string) => (again.prepare("SELECT meta_json FROM ad_creatives WHERE id = ?").get(id) as { meta_json: string }).meta_json;
    expect(JSON.parse(meta("c1"))).toEqual({ engine: "cloud", modelId: "ads-studio", route: "baked", ratio: "9:16" });
    expect(JSON.parse(meta("c2")).route).toBe("fuobe");
    expect(meta("c3")).toBe("not json");
  });
});
