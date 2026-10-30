import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-bodies-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_TRUST_PROXY;

const auth = await import("@/server/auth");
const { config } = await import("@/proxy");
const nextConfig = (await import("../next.config")).default;
const finish = await import("@/app/api/generations/[id]/finish/route");
const renders = await import("@/app/api/layers/renders/route");
const skillsUpload = await import("@/app/api/assist/skills/upload/route");
const sources = await import("@/app/api/assist/projects/[projectId]/sources/route");
const explainerDoc = await import("@/app/api/explainer/document/route");
const generations = await import("@/app/api/generations/route");

let owner = "";
let account = "";
beforeAll(() => {
  auth.setPassword("install password");
  owner = auth.createSession().value;
  account = auth.createSession(auth.createAccount("bodies@example.com", "long enough").id).value;
});
afterEach(() => delete process.env.FUOBE_ALLOWED_ORIGINS);
afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

const MB = 2 ** 20;
const bytes = (v: string | number | undefined) => {
  const m = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)$/i.exec(String(v ?? "10mb"));
  if (!m) return Number(v);
  return Number(m[1]) * { b: 1, kb: 2 ** 10, mb: MB, gb: 2 ** 30 }[m[2].toLowerCase() as "b" | "kb" | "mb" | "gb"];
};

/** The routes that take a big body (a file in a form): the proxy leaves them out and they check the asker themselves. */
const BIG = [
  { name: "finish", path: "/api/generations/g1/finish", call: (r: Request) => finish.POST(r, { params: Promise.resolve({ id: "g1" }) } as never) },
  { name: "layer renders", path: "/api/layers/renders", call: (r: Request) => renders.POST(r) },
  { name: "skill upload", path: "/api/assist/skills/upload", call: (r: Request) => skillsUpload.POST(r) },
  { name: "Assist sources", path: "/api/assist/projects/p1/sources", call: (r: Request) => sources.POST(r, { params: Promise.resolve({ projectId: "p1" }) } as never) },
  { name: "explainer document", path: "/api/explainer/document", call: (r: Request) => explainerDoc.POST(r) },
];

function form(pathname: string, init: { cookie?: string; headers?: Record<string, string> } = {}) {
  const body = new FormData();
  body.set("file", new File([Buffer.from("not a png")], "x.png", { type: "image/png" }));
  return new Request(`http://localhost:3000${pathname}`, { method: "POST", headers: { ...(init.cookie && { cookie: `${auth.SESSION_COOKIE}=${init.cookie}` }), ...init.headers }, body });
}

describe("M-3: the proxy holds at most a few MB of any request body", () => {
  it("buffers 4 MB at most", () => {
    expect(bytes(nextConfig.experimental?.proxyClientMaxBodySize)).toBeLessThanOrEqual(4 * MB);
    // Still more than the largest JSON body a page sends (Evolution's 2 MB frame).
    expect(bytes(nextConfig.experimental?.proxyClientMaxBodySize)).toBeGreaterThan(2 * MB + 64 * 1024);
  });

  it("leaves out only the routes that take a file in a form", () => {
    const matches = (p: string) => new RegExp(`^${config.matcher[0]}$`).test(p);
    for (const r of BIG) expect(matches(r.path), r.path).toBe(false);
    for (const p of ["/api/generations", "/api/generations/g1", "/api/generations/g1/cancel", "/api/layers", "/api/layers/abc", "/api/assist/skills", "/api/assist/projects/p1", "/api/assist/projects/p1/sources/s1", "/api/explainer"]) {
      expect(matches(p), p).toBe(true);
    }
  });

  it("each of those routes refuses a guest, an account and another website as the proxy would", async () => {
    for (const r of BIG) {
      expect((await r.call(form(r.path))).status, `${r.name}: guest`).toBe(401);
      expect((await r.call(form(r.path, { cookie: owner, headers: { origin: "http://evil.example" } }))).status, `${r.name}: cross-site`).toBe(403);
    }
    // An account: only its own run's finish passes the proxy's rules, and "g1" isn't its own.
    for (const r of BIG) expect((await r.call(form(r.path, { cookie: account }))).status, `${r.name}: account`).toBe(403);
  });

  it("each lets the owner through to the route's own checks", async () => {
    for (const r of BIG) expect([400, 404, 413, 415, 422], `${r.name}: owner`).toContain((await r.call(form(r.path, { cookie: owner }))).status);
  });

  it("a run request cut short at the proxy's limit says it is too large", async () => {
    const r = await generations.POST(
      new Request("http://localhost:3000/api/generations", {
        method: "POST",
        headers: { cookie: `${auth.SESSION_COOKIE}=${owner}`, "content-type": "application/json", "content-length": String(5 * MB) },
        body: `{"modelId":"oss-z-image-turbo","prompt":"x","inputs":{"images":["data:image/png;base64,AAAA`,
      }),
    );
    expect(r.status).toBe(413);
    expect((await r.json()).error).toMatch(/upload/i);
  });
});
