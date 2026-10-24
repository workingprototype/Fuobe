import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { loraEntry, loraRef } from "@/lib/catalog/loras";
import type { LoraRef } from "@/lib/catalog/types";

// The downloader reads the civitai key and the LoRA folder from the settings table: a throwaway data folder.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-lora-fetch-"));
process.env.FUOBE_DATA_DIR = dir;
const { downloadLora, ensureLorasOnComfy, prepareCloudLoras, listLoraCopies, lorasPath, redact, LORA_CACHE_DIR } = await import("@/server/loras");
const { setSetting } = await import("@/server/settings");
const { db } = await import("@/server/db");
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const KEY = "civitai-secret-0123456789abcdef";
const bytes = (s: string) => Buffer.from(s.repeat(64));
const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
}

/** A fake network: answers by URL prefix, records every call (with headers), never touches the internet. */
function network(routes: Record<string, (c: Call) => Response>) {
  const calls: Call[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const call = { url: String(input), method: init?.method ?? "GET", headers: Object.fromEntries(new Headers(init?.headers).entries()) };
    calls.push(call);
    const hit = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((k) => call.url.startsWith(k));
    if (!hit) return new Response("not here", { status: 404 });
    return routes[hit](call);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = real) };
}

let net: ReturnType<typeof network> | undefined;
let folder: string;
beforeEach(() => {
  folder = fs.mkdtempSync(path.join(dir, "loras-"));
  setSetting("civitaiKey", "");
  setSetting("comfyLorasDir", "");
  db().prepare("DELETE FROM lora_mirrors").run();
  fs.rmSync(LORA_CACHE_DIR, { recursive: true, force: true });
});
afterEach(() => net?.restore());

const aw = loraRef(loraEntry("awportrait")!);
const y2k = loraRef(loraEntry("y2k")!);
const AW_BODY = bytes("awportrait");
const Y2K_BODY = bytes("y2k-style");

/** Hugging Face: a HEAD answered with a redirect carrying the file's SHA256 and size, then the file. */
const hfRoutes = (body: Buffer, etag = sha(body)) => ({
  [aw.url!]: (c: Call) =>
    c.method === "HEAD"
      ? new Response(null, { status: 302, headers: { "x-linked-etag": `"${etag}"`, "x-linked-size": String(body.length), "x-repo-commit": "abc123" } })
      : new Response(new Uint8Array(body), { status: 200, headers: { "content-length": String(body.length) } }),
});

/** civitai: the version API (hash, size, model) and the download, which needs ?token=. */
const civitaiRoutes = (body: Buffer, opts: { modelId?: number; permissions?: string[]; hash?: string } = {}) => ({
  "https://civitai.com/api/v1/model-versions/3422541": () =>
    Response.json({ id: 3422541, modelId: opts.modelId ?? 2979601, files: [{ name: "V1.safetensors", primary: true, sizeKB: body.length / 1024, hashes: { SHA256: (opts.hash ?? sha(body)).toUpperCase() } }] }),
  "https://civitai.com/api/v1/models/2979601": () => Response.json({ id: 2979601, allowCommercialUse: opts.permissions ?? ["Image", "RentCivit", "Rent", "Sell"] }),
  "https://civitai.com/api/download/models/3422541": (c: Call) =>
    new URL(c.url).searchParams.get("token") === KEY ? new Response(new Uint8Array(body), { status: 200, headers: { "content-length": String(body.length) } }) : Response.json({ error: "Unauthorized" }, { status: 401 }),
});

describe("LoRA downloads (pinned, checked, never leaking the civitai key)", () => {
  it("downloads a Hugging Face file directly under its unique name and checks its SHA256", async () => {
    net = network(hfRoutes(AW_BODY));
    const got = await downloadLora(aw, folder);
    expect(got.path).toBe(path.join(folder, "AWPortrait-Z.safetensors"));
    expect(fs.readFileSync(got.path).equals(AW_BODY)).toBe(true);
    expect(got).toMatchObject({ sha256: sha(AW_BODY), sizeBytes: AW_BODY.length, version: "abc123", sourceUrl: aw.url });
    expect(fs.readdirSync(folder)).toEqual(["AWPortrait-Z.safetensors"]);
  });

  it("keeps nothing when the bytes don't match the stated hash", async () => {
    net = network(hfRoutes(AW_BODY, "0".repeat(64)));
    await expect(downloadLora(aw, folder)).rejects.toThrow(/doesn't match/);
    expect(fs.readdirSync(folder)).toEqual([]);
  });

  it("asks for a civitai key before touching a civitai download", async () => {
    net = network(civitaiRoutes(Y2K_BODY));
    await expect(downloadLora(y2k, folder)).rejects.toThrow(/needs your free API key: add it in Settings → LoRAs/);
    expect(net.calls.filter((c) => c.url.includes("/api/download/"))).toEqual([]);
  });

  it("downloads the pinned civitai version with ?token= and stores neither the key nor a tokenised URL", async () => {
    setSetting("civitaiKey", KEY);
    setSetting("comfyLorasDir", folder);
    net = network(civitaiRoutes(Y2K_BODY));
    await ensureLorasOnComfy([y2k], [], () => {});
    const saved = path.join(folder, "civitai-3422541-y2k.safetensors");
    expect(fs.readFileSync(saved).equals(Y2K_BODY)).toBe(true);
    // The version it asked civitai about is the pinned one, never "latest".
    expect(net.calls.map((c) => c.url.split("?")[0])).toEqual(["https://civitai.com/api/v1/model-versions/3422541", "https://civitai.com/api/download/models/3422541"]);
    const [copy] = listLoraCopies();
    expect(copy).toMatchObject({ file: "civitai-3422541-y2k.safetensors", target: "comfyui", version: "3422541", sha256: sha(Y2K_BODY), sourceUrl: y2k.url });
    // The licence snapshot it was made under.
    expect(copy.licence).toMatchObject({ commercial: true, hostedOk: true, snapshotDate: "2026-10-23", permissions: ["Image", "RentCivit", "Rent", "Sell", "SellMerge"] });
    const stored = JSON.stringify(db().prepare("SELECT * FROM lora_mirrors").all());
    expect(stored).not.toContain(KEY);
    expect(stored).not.toContain("token=");
  });

  it("says to check the key on a 401, without the key in the message", async () => {
    setSetting("civitaiKey", "wrong-key-987654321");
    net = network(civitaiRoutes(Y2K_BODY));
    const err = (await downloadLora(y2k, folder).catch((e: Error) => e)) as Error;
    expect(err.message).toMatch(/civitai refused the download of V67 Y2K Style \(401\): check your civitai key in Settings → LoRAs/);
    expect(err.message).not.toContain("wrong-key");
    expect(redact(`https://civitai.com/api/download/models/1?token=${KEY}`, KEY)).toBe("https://civitai.com/api/download/models/1?token=•••");
  });

  it("refuses an unpinned civitai URL and a version that belongs to another model", async () => {
    setSetting("civitaiKey", KEY);
    net = network(civitaiRoutes(Y2K_BODY, { modelId: 1 }));
    await expect(downloadLora({ ...y2k, file: "x.safetensors", url: "https://civitai.com/api/download/models/latest", version: undefined }, folder)).rejects.toThrow(/isn't pinned/);
    await expect(downloadLora(y2k, folder)).rejects.toThrow(/belongs to another model/);
    expect(fs.readdirSync(folder)).toEqual([]);
  });

  it("keeps every file inside the LoRA folder", () => {
    expect(lorasPath(folder, "fuobe/maya.safetensors")).toBe(path.join(folder, "fuobe", "maya.safetensors"));
    for (const bad of ["../evil.safetensors", "/etc/x.safetensors", "a/../../b.safetensors", "notes.txt", ""]) expect(() => lorasPath(folder, bad), bad).toThrow(/isn't a LoRA file name/);
  });
});

describe("Before a ComfyUI run", () => {
  it("does nothing when ComfyUI already lists the LoRA", async () => {
    net = network({});
    await ensureLorasOnComfy([aw], ["AWPortrait-Z.safetensors"]);
    expect(net.calls).toEqual([]);
  });

  it("says what to do when the LoRA is missing and no LoRA folder is set", async () => {
    net = network({});
    await expect(ensureLorasOnComfy([aw], ["other.safetensors"])).rejects.toThrow(
      /ComfyUI doesn't have Shakker-Labs AWPortrait-Z yet\. Set the LoRA folder in Settings → LoRAs .* put AWPortrait-Z\.safetensors in ComfyUI\/models\/loras \(from https:\/\/huggingface\.co\/Shakker-Labs\/AWPortrait-Z\)/,
    );
    // ComfyUI couldn't list its LoRAs and there's no folder to check: its own validation has the last word.
    await expect(ensureLorasOnComfy([aw], null)).resolves.toBeUndefined();
  });

  it("downloads a missing LoRA into the folder once, even when two runs ask at the same time", async () => {
    setSetting("comfyLorasDir", folder);
    net = network(hfRoutes(AW_BODY));
    const progress: string[] = [];
    await Promise.all([ensureLorasOnComfy([aw], [], (m) => progress.push(m)), ensureLorasOnComfy([aw], [])]);
    expect(net.calls.filter((c) => c.method === "GET")).toHaveLength(1);
    expect(progress[0]).toMatch(/^Downloading Shakker-Labs AWPortrait-Z/);
    expect(fs.existsSync(path.join(folder, "AWPortrait-Z.safetensors"))).toBe(true);
    // Already on disk (ComfyUI's list not refreshed yet): no second download.
    await ensureLorasOnComfy([aw], []);
    expect(net.calls.filter((c) => c.method === "GET")).toHaveLength(1);
  });
});

describe("Before a cloud run", () => {
  const upload = () => {
    const sent: { name: string; size: number }[] = [];
    return { sent, fn: async (data: Buffer, name: string) => (sent.push({ name, size: data.length }), `https://v3.fal.media/files/${name}`) };
  };

  it("sends public files as they are and mirrors a civitai file once (Rent allowed), then reuses the mirror", async () => {
    setSetting("civitaiKey", KEY);
    net = network(civitaiRoutes(Y2K_BODY));
    const up = upload();
    const first = (await prepareCloudLoras([aw, y2k], "fal", up.fn)) as LoraRef[];
    expect(first[0]).toBe(aw);
    expect(first[1].hostedUrl).toBe("https://v3.fal.media/files/civitai-3422541-y2k.safetensors");
    expect(up.sent).toEqual([{ name: "civitai-3422541-y2k.safetensors", size: Y2K_BODY.length }]);
    const mirror = listLoraCopies().find((c) => c.target === "fal")!;
    expect(mirror).toMatchObject({ hostedUrl: first[1].hostedUrl, version: "3422541", sha256: sha(Y2K_BODY) });
    expect(mirror.licence).toMatchObject({ permissionsNow: ["Image", "RentCivit", "Rent", "Sell"] });
    const again = (await prepareCloudLoras([y2k], "fal", up.fn)) as LoraRef[];
    expect(again[0].hostedUrl).toBe(first[1].hostedUrl);
    expect(up.sent).toHaveLength(1);
  });

  it("won't mirror when civitai no longer allows hosting, or a local-only LoRA", async () => {
    setSetting("civitaiKey", KEY);
    net = network(civitaiRoutes(Y2K_BODY, { permissions: ["Image", "RentCivit"] }));
    const up = upload();
    await expect(prepareCloudLoras([y2k], "fal", up.fn)).rejects.toThrow(/no longer allows running it on a hosted service/);
    const wiggle = loraRef(loraEntry("civitai-2490836-wiggle-redmond")!);
    await expect(prepareCloudLoras([wiggle], "replicate", up.fn)).rejects.toThrow(/runs only on your GPU/);
    expect(up.sent).toEqual([]);
  });
});
