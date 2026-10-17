import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-library-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const lib = await import("@/server/library");
const { saveFile, absolutePath } = await import("@/server/storage");
const { zipStream, zipSize } = await import("@/server/zip");
const { TOOLS } = await import("@/server/assist/tools");
const { POST: bulk } = await import("@/app/api/generations/bulk/route");
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

  it("cancels a running job deleted for good", async () => {
    const [job] = gens.createGenerations({ feature: "image", modelId: "nano-banana-pro", prompt: "a slow one" });
    lib.trashGenerations([job.id]);
    // Still running in the Trash (Restore brings it back as it is).
    expect(["queued", "running"]).toContain(gens.getGeneration(job.id, { includeDeleted: true })!.status);
    await lib.deleteForever([job.id]);
    expect(gens.getGeneration(job.id, { includeDeleted: true })).toBeNull();
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
