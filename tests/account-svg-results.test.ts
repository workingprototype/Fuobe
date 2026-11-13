import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "./helpers/temp-dir";

/**
 * An account's SVG result (Image to vector on a worker): kept as image/svg+xml when it is a checked SVG, as
 * application/octet-stream (.bin) otherwise; served with a script-free policy; and results stored as .bin before this
 * made SVGs again by scripts/readopt-svg-results.mjs.
 */

const dir = tempDir("fuobe-account-svg-");
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
globalThis.__fuobeTestDiskFree = 1e13;

const auth = await import("@/server/auth");
const { asAccount, persistOutput } = await import("@/server/generations");
const { absolutePath, newScratchOutput, saveFile } = await import("@/server/storage");
const { fileResponse, SVG_CSP } = await import("@/server/file-response");
const { db } = await import("@/server/db");

const CLEAN_SVG = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z" fill="#5d4bdb"/></svg>\n`;
const SCRIPT_SVG = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`;

auth.setPassword("install password");
const account = auth.createAccount("svg@example.com", "long enough").id;

/** A result the provider wrote to the scratch folder (the same path a worker's relay: result takes), kept as the account's. */
function keepScratch(body: string, contentType = "image/svg+xml") {
  const s = newScratchOutput("svg");
  fs.writeFileSync(s.file, body);
  return asAccount(account, () => persistOutput({ url: s.url, kind: "image", contentType }, "gen-svg-test", { linked: undefined }));
}

describe("an account's SVG result", () => {
  it("is kept as image/svg+xml when it is a checked SVG", async () => {
    const out = await keepScratch(CLEAN_SVG);
    expect(out.contentType).toBe("image/svg+xml");
    expect(out.kind).toBe("image");
    expect(out.url).toMatch(/\.svg$/);
    expect(fs.readFileSync(absolutePath(out.url.replace(/^\/api\/files\//, "")), "utf8")).toBe(CLEAN_SVG);
  });

  it("with a script in it stays application/octet-stream (.bin)", async () => {
    const out = await keepScratch(SCRIPT_SVG);
    expect(out.contentType).toBe("application/octet-stream");
    expect(out.url).toMatch(/\.bin$/);
    const handler = await keepScratch(`<svg xmlns="http://www.w3.org/2000/svg"><rect onclick="x()"/></svg>`);
    expect(handler.contentType).toBe("application/octet-stream");
  });

  it("from a data: link (persistOutput's own branch) is checked the same way", async () => {
    const url = (s: string) => `data:image/svg+xml;base64,${Buffer.from(s).toString("base64")}`;
    const ok = await asAccount(account, () => persistOutput({ url: url(CLEAN_SVG), kind: "image" }, "gen-svg-data", { linked: undefined }));
    expect(ok.contentType).toBe("image/svg+xml");
    const bad = await asAccount(account, () => persistOutput({ url: url(SCRIPT_SVG), kind: "image" }, "gen-svg-data", { linked: undefined }));
    expect(bad.contentType).toBe("application/octet-stream");
  });
});

describe("serving a stored SVG", () => {
  it("always sends the script-free policy and nosniff, and keeps a download's file name", async () => {
    const url = saveFile({ data: Buffer.from(CLEAN_SVG), contentType: "image/svg+xml", source: "generation", accountId: account }).url;
    const rel = url.replace(/^\/api\/files\//, "");
    for (const [q, headers] of [["", undefined], ["?download=logo.svg", { "Content-Security-Policy": "sandbox", "X-Content-Type-Options": "sniff" }]] as const) {
      const res = fileResponse(new Request(`http://localhost:3000${url}${q}`), rel, headers ? { headers } : {});
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/svg+xml");
      expect(res.headers.get("content-security-policy")).toBe(SVG_CSP);
      expect(SVG_CSP).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      if (q) expect(res.headers.get("content-disposition")).toBe(`attachment; filename="logo.svg"`);
      await res.body?.cancel();
    }
  });
});

describe("scripts/readopt-svg-results.mjs", () => {
  const run = (...args: string[]) => {
    const r = spawnSync(process.execPath, [path.join(process.cwd(), "scripts", "readopt-svg-results.mjs"), ...args], { env: { ...process.env, FUOBE_DATA_DIR: dir }, encoding: "utf8" });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };

  it("makes an SVG stored as .bin an SVG again (dry run first), and leaves any other .bin alone", () => {
    const svg = saveFile({ data: Buffer.from(CLEAN_SVG), contentType: "application/octet-stream", source: "generation", generationId: "gen-old-svg", accountId: account });
    const other = saveFile({ data: Buffer.from(SCRIPT_SVG), contentType: "application/octet-stream", source: "generation", generationId: "gen-old-svg", accountId: account });
    expect(svg.relPath).toMatch(/\.bin$/);
    const now = Date.now();
    const outputs = [
      { url: svg.url, kind: "image", contentType: "application/octet-stream", assetId: svg.id },
      { url: other.url, kind: "image", contentType: "application/octet-stream", assetId: other.id },
    ];
    const insert = db().prepare(
      "INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES (?, 'image', 'oss-vectorize', 'open', 'comfyui', 'vectorize', 'image', 'succeeded', ?, ?, ?, ?)",
    );
    insert.run("gen-old-svg", JSON.stringify({ account }), JSON.stringify(outputs), now, now);
    // A later run that used the result as its input.
    insert.run("gen-next", JSON.stringify({ account, inputs: { images: [svg.url] } }), "[]", now, now);

    const dry = run();
    expect(dry.code, dry.out).toBe(0);
    expect(dry.out).toContain("1 SVG result(s) stored as .bin; 1 other .bin result(s) left as they are (dry run");
    expect(dry.out).not.toContain("@example.com");
    expect(fs.existsSync(absolutePath(svg.relPath))).toBe(true);
    expect((db().prepare("SELECT content_type FROM assets WHERE id = ?").get(svg.id) as { content_type: string }).content_type).toBe("application/octet-stream");

    const applied = run("--apply");
    expect(applied.code, applied.out).toBe(0);
    expect(applied.out).toContain("1 changed");
    const row = db().prepare("SELECT rel_path, content_type, kind, account_id FROM assets WHERE id = ?").get(svg.id) as { rel_path: string; content_type: string; kind: string; account_id: string };
    expect(row).toMatchObject({ content_type: "image/svg+xml", kind: "image", account_id: account });
    expect(row.rel_path).toMatch(/\.svg$/);
    expect(fs.existsSync(absolutePath(svg.relPath))).toBe(false);
    expect(fs.readFileSync(absolutePath(row.rel_path), "utf8")).toBe(CLEAN_SVG);
    const newUrl = svg.url.replace(/\.bin$/, ".svg");
    const kept = JSON.parse((db().prepare("SELECT outputs_json FROM generations WHERE id = 'gen-old-svg'").get() as { outputs_json: string }).outputs_json);
    expect(kept[0]).toEqual({ url: newUrl, kind: "image", contentType: "image/svg+xml", assetId: svg.id });
    expect(kept[1]).toEqual(outputs[1]);
    const next = JSON.parse((db().prepare("SELECT request_json FROM generations WHERE id = 'gen-next'").get() as { request_json: string }).request_json);
    expect(next.inputs.images).toEqual([newUrl]);
    expect((db().prepare("SELECT content_type FROM assets WHERE id = ?").get(other.id) as { content_type: string }).content_type).toBe("application/octet-stream");

    // Run again: nothing left to change.
    expect(run("--apply").out).toContain("0 SVG result(s) stored as .bin");
  });
});
