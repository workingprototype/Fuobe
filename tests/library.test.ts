import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Route handlers call connection() (no request scope in a test).
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-library-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const lib = await import("@/server/library");
const { saveFile, absolutePath, listAssets } = await import("@/server/storage");
const { zipStream, zipSize } = await import("@/server/zip");
const { TOOLS } = await import("@/server/assist/tools");
const { POST: bulk } = await import("@/app/api/generations/bulk/route");
const folderRoutes = await import("@/app/api/folders/route");
const folderIdRoutes = await import("@/app/api/folders/[id]/route");
const { db } = await import("@/server/db");

beforeAll(() => setSetting("demoMode", "auto"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const DAY = 86_400_000;
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

/** A finished generation with a real output file (recorded like a browser colour grade). */
function made(prompt: string) {
  const asset = saveFile({ data: Buffer.concat([PNG, Buffer.from(prompt)]), contentType: "image/png", source: "generation" });
  const g = gens.recordLocalGeneration({
    feature: "grade",
    modelId: "local-color-grade",
    op: "grade",
    prompt,
    inputs: { images: ["/api/files/uploads/x.png"] },
    output: { url: asset.url, kind: "image", contentType: "image/png" },
  });
  db().prepare("UPDATE assets SET generation_id = ? WHERE id = ?").run(g.id, asset.id);
  return { g, asset };
}

const fileOf = (url: string) => absolutePath(decodeURIComponent(url.slice("/api/files/".length)));
const listIds = (o: Parameters<typeof gens.listGenerations>[0] = {}) => gens.listGenerations({ limit: 200, ...o }).map((g) => g.id);

describe("generation names", () => {
  it("carries the model and preset names and the aspect ratio, so result views need no catalog", () => {
    const { g } = made("names");
    expect(g.modelName).toBe("Color Grading");
    expect(g.presetName).toBeNull();
    const [img] = gens.createGenerations({ feature: "image", modelId: "nano-banana-pro", prompt: "a fox", params: { aspectRatio: "16:9" } });
    expect(img.modelName).toBe("Nano Banana Pro");
    expect(img.aspectRatio).toBe("16:9");
    expect(img.deletedAt).toBeNull();
    expect(img.folderId).toBeNull();
  });
});

describe("trash (soft delete)", () => {
  it("hides trashed generations from every reader and restores them", async () => {
    const a = made("alpha lighthouse").g;
    const b = made("beta lighthouse").g;
    expect(lib.trashGenerations([a.id])).toBe(1);
    expect(lib.trashGenerations([a.id])).toBe(0); // already there
    expect(listIds()).not.toContain(a.id);
    expect(listIds()).toContain(b.id);
    expect(listIds({ q: "lighthouse" })).toEqual([b.id]);
    expect(gens.getGeneration(a.id)).toBeNull();
    expect(gens.getGeneration(a.id, { includeDeleted: true })?.deletedAt).toBeGreaterThan(0);
    // Assist / MCP list_recent goes through listGenerations.
    const recent = TOOLS.find((t) => t.name === "list_recent")!;
    const out = await recent.run({ limit: 30 }, {} as never);
    expect(String(out.content)).not.toContain(a.id);
    // The Trash lists it, newest deletion first.
    const trash = gens.listGenerations({ trashed: true });
    expect(trash.map((g) => g.id)).toEqual([a.id]);
    expect(trash[0].deletedAt).toBeTypeOf("number");
    expect(lib.libraryFacets().trash).toBe(1);

    expect(lib.restoreGenerations([a.id])).toBe(1);
    expect(gens.getGeneration(a.id)?.deletedAt).toBeNull();
    expect(listIds()).toContain(a.id);
  });

  it("deletes for good, keeping output files something else still uses", async () => {
    const lone = made("lone");
    const used = made("used as a character");
    db()
      .prepare("INSERT INTO characters (id, name, reference_asset_ids_json, status, created_at, updated_at) VALUES ('c1', 'Maya', ?, 'ready', 0, 0)")
      .run(JSON.stringify([used.asset.url]));
    lib.trashGenerations([lone.g.id, used.g.id]);
    expect(await lib.deleteForever([lone.g.id, used.g.id])).toBe(2);
    expect(gens.getGeneration(lone.g.id, { includeDeleted: true })).toBeNull();
    expect(fs.existsSync(fileOf(lone.asset.url))).toBe(false);
    expect(fs.existsSync(fileOf(used.asset.url))).toBe(true);
    expect(gens.listGenerations({ trashed: true }).map((g) => g.id)).not.toContain(lone.g.id);
  });

  it("purges what has been in the Trash for 30 days", async () => {
    const old = made("old").g;
    const recent = made("recent").g;
    const now = Date.now();
    lib.trashGenerations([old.id], now - 31 * DAY);
    lib.trashGenerations([recent.id], now - 2 * DAY);
    expect(await lib.purgeTrash(now)).toBe(1);
    expect(gens.getGeneration(old.id, { includeDeleted: true })).toBeNull();
    expect(gens.getGeneration(recent.id, { includeDeleted: true })?.deletedAt).toBe(now - 2 * DAY);
    expect(await lib.emptyTrash()).toBeGreaterThanOrEqual(1);
    expect(gens.listGenerations({ trashed: true })).toEqual([]);
  });

  it("cancels a job moved to the Trash (Restore brings it back canceled), and one deleted for good", async () => {
    const [job] = gens.createGenerations({ feature: "image", modelId: "nano-banana-pro", prompt: "a slow one" });
    lib.trashGenerations([job.id]);
    // It doesn't keep rendering (and billing) out of sight.
    await vi.waitFor(() => expect(gens.getGeneration(job.id, { includeDeleted: true })!.status).toBe("canceled"));
    lib.restoreGenerations([job.id]);
    expect(gens.getGeneration(job.id)?.status).toBe("canceled");
    const [other] = gens.createGenerations({ feature: "image", modelId: "nano-banana-pro", prompt: "another slow one" });
    await lib.deleteForever([other.id]);
    expect(gens.getGeneration(other.id, { includeDeleted: true })).toBeNull();
  });

  it("keeps output files still used by Cinema, canvases or Assist chats when deleting for good", async () => {
    const cover = made("cinema cover");
    const node = made("canvas input");
    const chat = made("chat attachment");
    const lone = made("nobody uses this");
    const now = Date.now();
    db().prepare("INSERT INTO cinema_projects (id, name, cover_url, created_at, updated_at) VALUES ('p-keep', 'Keep', ?, ?, ?)").run(cover.asset.url, now, now);
    // Its own Cinema membership doesn't keep a take's files.
    db().prepare("INSERT INTO cinema_items (project_id, generation_id, meta_json, created_at) VALUES ('p-keep', ?, ?, ?)").run(lone.g.id, JSON.stringify({ tiles: [{ url: lone.asset.url, row: 0, col: 0 }] }), now);
    db()
      .prepare("INSERT INTO canvases (id, name, graph_json, created_at, updated_at) VALUES ('c-keep', 'Board', ?, ?, ?)")
      .run(JSON.stringify({ nodes: [{ id: "n1", data: { url: node.asset.url } }], edges: [] }), now, now);
    db()
      .prepare("INSERT INTO assist_threads (id, title, status, agent, engine, messages_json, created_at, updated_at) VALUES ('t-keep', 'Chat', 'idle', 'offline', 'cloud', ?, ?, ?)")
      .run(JSON.stringify([{ role: "user", content: [{ type: "text", text: `see ${chat.asset.url}` }] }]), now, now);
    expect(gens.assetInUse(cover.asset.id)).toBe(true);
    expect(gens.assetInUse(lone.asset.id, lone.g.id)).toBe(false);
    lib.trashGenerations([cover.g.id, node.g.id, chat.g.id, lone.g.id]);
    expect(await lib.deleteForever([cover.g.id, node.g.id, chat.g.id, lone.g.id])).toBe(4);
    for (const kept of [cover, node, chat]) expect(fs.existsSync(fileOf(kept.asset.url))).toBe(true);
    expect(fs.existsSync(fileOf(lone.asset.url))).toBe(false);
  });

  it("empties a Trash with dangling entries (rows already gone)", async () => {
    const a = made("dangling a").g;
    lib.trashGenerations([a.id]);
    db().prepare("INSERT INTO generation_trash (generation_id, deleted_at) VALUES ('ghost', ?)").run(Date.now());
    expect(await lib.emptyTrash()).toBe(1);
    expect(db().prepare("SELECT COUNT(*) AS n FROM generation_trash").get()).toEqual({ n: 0 });
  });
});

describe("paging", () => {
  const pageAll = (o: NonNullable<Parameters<typeof gens.listGenerations>[0]>, limit: number) => {
    const seen: string[] = [];
    let cursor: { before?: number; beforeId?: string } = {};
    for (let i = 0; i < 20; i++) {
      const page = gens.listGenerations({ ...o, ...cursor, limit });
      seen.push(...page.map((g) => g.id));
      if (page.length < limit) break;
      const last = page.at(-1)!;
      cursor = lib.cursorFrom(`${o.trashed ? last.deletedAt : last.createdAt}:${last.id}`);
    }
    return seen;
  };

  it("pages a bulk trash (one deletedAt for all) without skipping any", () => {
    const items = Array.from({ length: 70 }, (_, i) => made(`tie-trash ${i}`).g.id);
    expect(lib.trashGenerations(items)).toBe(70);
    const seen = pageAll({ trashed: true, q: "tie-trash" }, 60);
    expect(seen).toHaveLength(70);
    expect(new Set(seen).size).toBe(70);
    // The old timestamp-only cursor lost the 10 that share the boundary's deletedAt.
    const first = gens.listGenerations({ trashed: true, q: "tie-trash", limit: 60 });
    expect(gens.listGenerations({ trashed: true, q: "tie-trash", limit: 60, before: first.at(-1)!.deletedAt! })).toHaveLength(0);
    lib.restoreGenerations(items);
  });

  it("pages rows made in the same millisecond (storyboard frames, pipelines) without skipping any", () => {
    const items = Array.from({ length: 6 }, (_, i) => made(`tie-created ${i}`).g.id);
    db().prepare(`UPDATE generations SET created_at = 1234 WHERE id IN (${items.map(() => "?").join(",")})`).run(...items);
    const seen = pageAll({ q: "tie-created" }, 4);
    expect(seen.sort()).toEqual([...items].sort());
  });

  it("pages uploads (the Uploads tab) the same way", () => {
    const ups = Array.from({ length: 5 }, (_, i) => saveFile({ data: Buffer.concat([PNG, Buffer.from(`up ${i}`)]), contentType: "image/png", source: "upload" }).id);
    db().prepare(`UPDATE assets SET created_at = 4321 WHERE id IN (${ups.map(() => "?").join(",")})`).run(...ups);
    const seen: string[] = [];
    let cursor: { before?: number; beforeId?: string } = { before: 4322 };
    for (let i = 0; i < 5; i++) {
      const page = listAssets({ source: "upload", limit: 2, ...cursor }).filter((a) => a.createdAt === 4321);
      seen.push(...page.map((a) => a.id));
      if (page.length < 2) break;
      cursor = lib.cursorFrom(`${page[1].createdAt}:${page[1].id}`);
    }
    expect(seen.sort()).toEqual([...ups].sort());
  });

  it("reads the cursor in both forms", () => {
    expect(lib.cursorFrom("1700000000000:Ab_c-9")).toEqual({ before: 1700000000000, beforeId: "Ab_c-9" });
    expect(lib.cursorFrom("1700000000000")).toEqual({ before: 1700000000000 });
    expect(lib.cursorFrom("nope")).toEqual({});
    expect(lib.cursorFrom(null)).toEqual({});
  });
});

describe("list filters (GET /api/generations)", () => {
  it("maps every query field and ignores unknown values", () => {
    const sp = new URLSearchParams({
      kinds: "image,video,bogus",
      models: "a,b",
      statuses: "failed,canceled,exploded",
      since: "100",
      until: "200",
      folder: "f1",
      q: "koi",
      favorites: "1",
      trash: "1",
      limit: "30",
      before: "150:xyz",
      features: "image,video*",
      kind: "nope",
    });
    expect(lib.listOptionsFrom(sp)).toMatchObject({
      kinds: ["image", "video"],
      models: ["a", "b"],
      statuses: ["failed", "canceled"],
      since: 100,
      until: 200,
      folderId: "f1",
      q: "koi",
      favorites: true,
      trashed: true,
      limit: 30,
      before: 150,
      beforeId: "xyz",
      features: ["image", "video*"],
      kind: undefined,
    });
  });

  it("filters by kind, model, status, date, folder and the user's own words", () => {
    const a = made("filter alpha").g;
    const b = made("filter beta").g;
    db().prepare("UPDATE generations SET status = 'failed', created_at = 50, request_json = ? WHERE id = ?").run(JSON.stringify({ ...b.request, prompt: "my words: zebra" }), b.id);
    const f = lib.createFolder({ name: "Filters" });
    lib.moveToFolder([a.id], f.id);
    const ids = (q: Record<string, string>) => gens.listGenerations({ ...lib.listOptionsFrom(new URLSearchParams(q)), limit: 200 }).map((g) => g.id);
    expect(ids({ q: "zebra" })).toEqual([b.id]); // request.prompt, not only the model's prompt
    expect(ids({ statuses: "failed", q: "filter" })).toEqual([b.id]);
    expect(ids({ until: "100", q: "filter" })).toEqual([b.id]);
    expect(ids({ since: "100", q: "filter" })).toEqual([a.id]);
    expect(ids({ folder: f.id })).toEqual([a.id]);
    expect(ids({ kinds: "video", q: "filter" })).toEqual([]);
    expect(ids({ models: "local-color-grade", q: "filter" }).sort()).toEqual([a.id, b.id].sort());
    expect(ids({ models: "other", q: "filter" })).toEqual([]);
    lib.deleteFolder(f.id);
  });

  it("counts facets for the filter menus", () => {
    const before = lib.libraryFacets();
    const g = made("facet one").g;
    lib.setFavorites([g.id], true);
    const failed = made("facet two").g;
    db().prepare("UPDATE generations SET status = 'failed' WHERE id = ?").run(failed.id);
    const gone = made("facet three").g;
    lib.trashGenerations([gone.id]);
    const after = lib.libraryFacets();
    expect(after.total - before.total).toBe(2);
    expect(after.favorites - before.favorites).toBe(1);
    expect(after.failed - before.failed).toBe(1);
    expect(after.trash - before.trash).toBe(1);
    expect((after.kinds.image ?? 0) - (before.kinds.image ?? 0)).toBe(2);
    expect(after.models.find((m) => m.id === "local-color-grade")?.name).toBe("Color Grading");
  });
});

describe("Assist plans", () => {
  it("puts a plan's independent jobs in one batch, titled with its summary, so the Library stacks them", async () => {
    const generate = TOOLS.find((t) => t.name === "generate")!;
    const out = await generate.run(
      {
        summary: "Two animal posters",
        jobs: [
          { model_id: "nano-banana-pro", prompt: "a fox poster" },
          { model_id: "nano-banana-pro", prompt: "an owl poster" },
        ],
      },
      { engine: "cloud" },
    );
    const ids = (out.items?.[0] as { ids: string[] }).ids;
    const made = ids.map((id) => gens.getGeneration(id)!);
    expect(made).toHaveLength(2);
    expect(made[0].batchId).toBeTruthy();
    expect(made[1].batchId).toBe(made[0].batchId);
    expect(made.map((g) => g.request.batchTitle)).toEqual(["Two animal posters", "Two animal posters"]);
  });
});

describe("folder routes", () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
  const body = (b: unknown, method = "POST") => new Request("http://x/api/folders", { method, body: JSON.stringify(b) });

  it("creates, refuses duplicates, renames, 404s and deletes", async () => {
    const res = await folderRoutes.POST(body({ name: "Routes", color: "cyan" }));
    expect(res.status).toBe(201);
    const f = (await res.json()) as { id: string; name: string };
    expect((await folderRoutes.POST(body({ name: "routes" }))).status).toBe(409);
    expect((await folderRoutes.POST(body({ name: " " }))).status).toBe(400);
    expect(((await (await folderRoutes.GET()).json()) as { items: { id: string }[] }).items.map((x) => x.id)).toContain(f.id);
    const renamed = await folderIdRoutes.PATCH(body({ name: "Routes 2" }, "PATCH"), ctx(f.id));
    expect(((await renamed.json()) as { name: string }).name).toBe("Routes 2");
    expect((await folderIdRoutes.PATCH(body({ name: "x" }, "PATCH"), ctx("missing"))).status).toBe(404);
    expect((await folderIdRoutes.GET(new Request("http://x"), ctx("missing"))).status).toBe(404);
    expect((await folderIdRoutes.DELETE(new Request("http://x"), ctx(f.id))).status).toBe(204);
    expect((await folderIdRoutes.DELETE(new Request("http://x"), ctx(f.id))).status).toBe(404);
  });
});

describe("folders", () => {
  it("creates, renames, recolours, moves into and deletes folders", () => {
    const f = lib.createFolder({ name: "Campaign", color: "pink" });
    expect(f).toMatchObject({ name: "Campaign", color: "pink", count: 0, cover: null });
    expect(() => lib.createFolder({ name: "campaign" })).toThrow(/already a folder/);
    expect(lib.createFolder({ name: "Other", color: "nope" }).color).toBe("lime");
    const a = made("in folder a").g;
    const b = made("in folder b").g;
    // The cover is the newest: make b clearly newer (both can land in the same millisecond).
    db().prepare("UPDATE generations SET created_at = created_at + 1000 WHERE id = ?").run(b.id);
    expect(lib.moveToFolder([a.id, b.id], f.id)).toBe(2);
    expect(lib.getFolder(f.id)).toMatchObject({ count: 2 });
    expect(lib.getFolder(f.id)!.cover?.url).toBe(b.outputs[0].url);
    expect(listIds({ folderId: f.id }).sort()).toEqual([a.id, b.id].sort());
    expect(gens.getGeneration(a.id)?.folderId).toBe(f.id);
    // Trashed items don't count.
    lib.trashGenerations([b.id]);
    expect(lib.getFolder(f.id)!.count).toBe(1);
    lib.restoreGenerations([b.id]);
    // Moving back to the root.
    lib.moveToFolder([b.id], null);
    expect(listIds({ folderId: f.id })).toEqual([a.id]);
    expect(lib.updateFolder(f.id, { name: "Launch", color: "cyan" })).toMatchObject({ name: "Launch", color: "cyan" });
    expect(() => lib.moveToFolder([a.id], "missing")).toThrow(/doesn't exist/);
    // Deleting the folder keeps what was in it.
    expect(lib.deleteFolder(f.id)).toBe(true);
    expect(gens.getGeneration(a.id)?.folderId).toBeNull();
    expect(lib.listFolders().map((x) => x.name)).toEqual(["Other"]);
  });
});

describe("bulk endpoint", () => {
  const call = async (body: unknown) => {
    const res = await bulk(new Request("http://x/api/generations/bulk", { method: "POST", body: JSON.stringify(body) }));
    return { status: res.status, body: (await res.json()) as { count?: number; error?: string } };
  };

  it("favorites, moves, trashes, restores and deletes many at once", async () => {
    const items = [made("bulk 1").g, made("bulk 2").g, made("bulk 3").g];
    const ids = items.map((g) => g.id);
    expect(await call({ action: "favorite", ids })).toEqual({ status: 200, body: { count: 3 } });
    expect(gens.listGenerations({ favorites: true }).filter((g) => ids.includes(g.id))).toHaveLength(3);
    const folder = lib.createFolder({ name: "Bulk" });
    expect((await call({ action: "move", ids, folderId: folder.id })).body.count).toBe(3);
    expect((await call({ action: "trash", ids: ids.slice(0, 2) })).body.count).toBe(2);
    expect(listIds({ folderId: folder.id })).toEqual([ids[2]]);
    expect((await call({ action: "restore", ids: [ids[0]] })).body.count).toBe(1);
    expect((await call({ action: "delete", ids: [ids[1]] })).body.count).toBe(1);
    expect(gens.getGeneration(ids[1], { includeDeleted: true })).toBeNull();
    expect((await call({ action: "move", ids, folderId: "gone" })).status).toBe(422);
    expect((await call({ action: "explode", ids })).status).toBe(400);
    expect((await call({ action: "trash", ids: [] })).status).toBe(400);
  });
});

describe("zip download", () => {
  it("streams a zip other tools can read, with unique readable names", async () => {
    const a = made("zip me").g;
    const b = made("zip me").g;
    const entries = lib.zipEntries([a.id, b.id, "missing"]);
    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((e) => e.name)).size).toBe(2);
    expect(entries[0].name).toMatch(/^zip-me-.{6}\.png$/);
    const chunks: Uint8Array[] = [];
    const reader = zipStream(entries).getReader();
    for (let r = await reader.read(); !r.done; r = await reader.read()) chunks.push(r.value);
    const buf = Buffer.concat(chunks);
    expect(buf.length).toBe(zipSize(entries));
    const file = path.join(dir, "out.zip");
    fs.writeFileSync(file, buf);
    const out = execFileSync("python3", ["-I", "-c", "import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip(), len(z.namelist()), z.read(z.namelist()[0])[-6:].decode())", file]).toString();
    expect(out.trim()).toBe("None 2 zip me");
  });
});
