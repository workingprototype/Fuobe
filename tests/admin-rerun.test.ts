import http from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { listenOnFreePort, startFakeBilling, type FakeBilling } from "./helpers/fake-billing";
import { startFakeComfy, type FakeComfy } from "./helpers/fake-comfy-runner";
import { tempDir } from "./helpers/temp-dir";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

// POST /api/admin/generations/{id}/rerun: an account's failed or cancelled run made again in its account, through its
// own Run (the same checks, the billing service's reserve, the line). A stand-in billing service and a stand-in ComfyUI
// as this install's GPUs.
const dir = tempDir("fuobe-admin-rerun-");
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_ALLOW_PRIVATE_URLS;
delete process.env.FUOBE_MODERATION_URL;
globalThis.__fuobeTestDiskFree = 1e13;

const probe = http.createServer();
const comfyPort = await listenOnFreePort(probe);
await new Promise<void>((r) => probe.close(() => r()));
const comfy: FakeComfy = await startFakeComfy({ output: "image", delayMs: 0 }, comfyPort);
process.env.COMFYUI_URL = comfy.url;

const auth = await import("@/server/auth");
const generationsRoute = await import("@/app/api/generations/route");
const rerunRoute = await import("@/app/api/admin/generations/[id]/rerun/route");
const listRoute = await import("@/app/api/admin/generations/route");
const oneRoute = await import("@/app/api/admin/generations/[id]/route");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const billing = await import("@/server/billing");
const tokens = await import("@/server/admin-tokens");
const { getGeneration } = await import("@/server/generations");

let fake: FakeBilling;
let a = "";
let cookie = "";
let owner = "";
beforeAll(async () => {
  fake = await startFakeBilling();
  globalThis.__fuobeTestGpuPort = comfy.port;
  auth.setPassword("install password");
  owner = `${auth.SESSION_COOKIE}=${auth.createSession().value}`;
  a = auth.createAccount("rerun@example.com", "long enough").id;
  cookie = `${auth.SESSION_COOKIE}=${auth.createSession(a).value}`;
});
afterAll(async () => {
  globalThis.__fuobeTestGpuPort = undefined;
  globalThis.__fuobeTestDiskFree = undefined;
  delete process.env.FUOBE_HOSTED_RUNS;
  delete process.env.FUOBE_BILLING_URL;
  delete process.env.FUOBE_BILLING_TOKEN;
  delete process.env.FUOBE_PUBLIC_SIGNUP;
  await fake.close();
  await comfy.close();
});

beforeEach(() => {
  resetRates();
  billing.resetBillingCache();
  fake.calls.length = 0;
  fake.down = false;
  fake.refuse = null;
  fake.price = { amount: 7, version: "v7" };
  process.env.FUOBE_HOSTED_RUNS = "1";
  process.env.FUOBE_BILLING_URL = fake.url;
  process.env.FUOBE_BILLING_TOKEN = "test-billing-token";
  db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
});

const post = (body: unknown, c = cookie) => {
  const text = JSON.stringify(body);
  return generationsRoute.POST(
    new Request("http://localhost:3000/api/generations", { method: "POST", headers: { cookie: c, host: "localhost:3000", "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) }, body: text }),
  );
};
const rerun = (id: string, body: unknown = {}, headers: Record<string, string> = { cookie: owner }) =>
  rerunRoute.POST(
    new Request(`http://localhost:3000/api/admin/generations/${id}/rerun`, { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json", ...headers }, body: body === undefined ? "" : JSON.stringify(body) }),
    { params: Promise.resolve({ id }) } as never,
  );
const stored = (id: string) => JSON.parse((db().prepare("SELECT request_json FROM generations WHERE id = ?").get(id) as { request_json: string }).request_json) as Record<string, unknown> & { params?: Record<string, unknown> };
const setStatus = (id: string, status: string) => db().prepare("UPDATE generations SET status = ? WHERE id = ?").run(status, id);
const lastAudit = () => db().prepare("SELECT action, target, detail_json, status FROM admin_audit ORDER BY id DESC LIMIT 1").get() as { action: string; target: string | null; detail_json: string | null; status: number };

/** A run the account made with its Run, ended as `status`. */
async function ended(status: "failed" | "canceled", body: Record<string, unknown> = {}): Promise<string> {
  const r = await post({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a lighthouse at dusk", params: { aspectRatio: "16:9", seed: 3 }, shown: { amount: 7, priceVersion: "v7" }, ...body });
  expect(r.status).toBe(201);
  const id = ((await r.json()) as { items: { id: string }[] }).items[0].id;
  setStatus(id, status);
  return id;
}

describe("re-running an account's run for it", () => {
  it("makes a new run in the same account through its Run: the same request, reserved and queued on this install's GPUs", async () => {
    const first = await ended("canceled");
    expect(fake.calls_of("/v1/reserve")).toHaveLength(1);

    const res = await rerun(first, { reason: "It took too long; the person asked again" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { run: string; account: string; ids: string[] };
    expect(body).toMatchObject({ run: first, account: a });
    expect(body.ids).toHaveLength(1);
    expect(body.ids[0]).not.toBe(first);

    const made = stored(body.ids[0]);
    expect(made).toMatchObject({ account: a, place: "pool", prompt: "a lighthouse at dusk", modelId: "oss-z-image-turbo" });
    expect(made.params).toMatchObject({ aspectRatio: "16:9", seed: 3 });
    // Priced and set aside like any press of Run: the billing service's reserve, with the price its page would show.
    const reserves = fake.calls_of("/v1/reserve");
    expect(reserves).toHaveLength(2);
    expect((reserves[1].body as { shown?: unknown }).shown).toEqual({ amount: 7, priceVersion: "v7" });
    expect(made.hold).toBeTruthy();
    // To the account it is a run like any other: no word of a re-run or an admin.
    const g = getGeneration(body.ids[0])!;
    expect(JSON.stringify(g)).not.toMatch(/rerun|re-run|admin/i);
    expect(made.notice).toBeUndefined();

    const log = lastAudit();
    expect(log).toMatchObject({ action: "run.rerun", target: first, status: 201 });
    expect(JSON.parse(log.detail_json!)).toMatchObject({ account: a, ids: body.ids, reason: "It took too long; the person asked again" });
    expect(log.detail_json).not.toContain("lighthouse");
  });

  it("links the two runs in the admin API, and makes one re-run of a run", async () => {
    const first = await ended("failed");
    const res = await rerun(first);
    expect(res.status).toBe(201);
    const { ids } = (await res.json()) as { ids: string[] };
    const one = (id: string) => oneRoute.GET(new Request(`http://localhost:3000/api/admin/generations/${id}`, { headers: { cookie: owner, host: "localhost:3000" } }), { params: Promise.resolve({ id }) } as never);
    expect(await (await one(first)).json()).toMatchObject({ rerunAs: ids[0] });
    expect(await (await one(ids[0])).json()).toMatchObject({ rerunOf: first });
    const list = (await (await listRoute.GET(new Request("http://localhost:3000/api/admin/generations?limit=100", { headers: { cookie: owner, host: "localhost:3000" } }))).json()) as { items: { id: string; rerunOf?: string; rerunAs?: string }[] };
    expect(list.items.find((r) => r.id === first)).toMatchObject({ rerunAs: ids[0] });
    expect(list.items.find((r) => r.id === ids[0])).toMatchObject({ rerunOf: first });
    // The account's own list says nothing of it.
    const mine = await (await generationsRoute.GET(new Request("http://localhost:3000/api/generations", { headers: { cookie, host: "localhost:3000" } }))).text();
    expect(mine).not.toMatch(/rerun/i);

    const again = await rerun(first);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "rerun-already", rerunAs: ids[0] });
    // The new run, once it fails too, can be re-run in turn.
    setStatus(ids[0], "failed");
    expect((await rerun(ids[0])).status).toBe(201);
  });

  it("takes only a run that failed or was cancelled, not in the Trash, and not a step of a longer run", async () => {
    const id = await ended("failed");
    for (const s of ["queued", "running", "succeeded"]) {
      setStatus(id, s);
      const r = await rerun(id);
      expect(r.status).toBe(409);
      expect(await r.json()).toMatchObject({ code: "not-ended" });
    }
    setStatus(id, "canceled");
    db().prepare("INSERT INTO generation_trash (generation_id, deleted_at) VALUES (?, ?)").run(id, Date.now());
    expect(await (await rerun(id)).json()).toMatchObject({ code: "deleted" });
    db().prepare("DELETE FROM generation_trash WHERE generation_id = ?").run(id);
    const step = await ended("failed");
    db().prepare("UPDATE generations SET depends_on = ? WHERE id = ?").run(id, step);
    expect(await (await rerun(step)).json()).toMatchObject({ code: "chained" });
    expect(await (await rerun(id)).json()).toMatchObject({ code: "chained" });
    expect((await rerun("no-such-run")).status).toBe(404);
    expect(lastAudit()).toMatchObject({ action: "run.rerun", target: "no-such-run", status: 404 });
  });

  it("says when its input files are no longer here", async () => {
    const id = await ended("failed");
    db()
      .prepare("UPDATE generations SET request_json = json_set(request_json, '$.inputs', json(?)) WHERE id = ?")
      .run(JSON.stringify({ image: "/api/files/uploads/gone.png" }), id);
    const r = await rerun(id);
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: "Its input files are no longer here", code: "input-gone" });
    expect(fake.calls_of("/v1/reserve")).toHaveLength(1);
  });

  it("answers what the account's Run answers when a service refuses, and makes nothing", async () => {
    const id = await ended("canceled");
    const before = (db().prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n;
    fake.refuse = { code: "limit", text: "Your plan's runs for today are used up." };
    const r = await rerun(id);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(((await r.json()) as { error: string }).error).toBe("Your plan's runs for today are used up.");
    expect((db().prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n).toBe(before);
    // Nothing kept of the try: once the service takes it, the run is made.
    fake.refuse = null;
    expect((await rerun(id)).status).toBe(201);
  });

  it("is the owner's, or an admin token's with runs:write", async () => {
    const id = await ended("failed");
    expect((await rerun(id, {}, { cookie })).status).toBe(403);
    const control = tokens.createAdminToken({ name: "control", scopes: ["queue:control", "runs:read"] }).token;
    const denied = await rerun(id, {}, { authorization: `Bearer ${control}` });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "scope", scope: "runs:write" });
    const writer = tokens.createAdminToken({ name: "writer", scopes: ["runs:write"] }).token;
    const ok = await rerun(id, { reason: "x".repeat(400) }, { authorization: `Bearer ${writer}` });
    expect(ok.status).toBe(201);
    const detail = JSON.parse(lastAudit().detail_json!) as { reason: string };
    expect(detail.reason).toHaveLength(300);
    for (const bad of [{ reason: 5 }]) expect((await rerun(id, bad)).status).toBe(400);
  });

  it("never reads a client's request as an account's", async () => {
    const r = await post({ feature: "image", modelId: "oss-z-image-turbo", prompt: "x" }, "");
    expect(r.status).toBe(401);
  });
});
