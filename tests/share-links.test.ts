import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ShareListItem } from "@/lib/share";
import type { ShareRow } from "@/server/share-access";

// Route handlers call connection() (no request scope in a test).
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-share-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_TRUST_PROXY;

const share = await import("@/lib/share");
const gens = await import("@/server/generations");
const lib = await import("@/server/library");
const cinema = await import("@/server/cinema");
const access = await import("@/server/share-access");
const shares = await import("@/server/shares");
const auth = await import("@/server/auth");
const { saveFile } = await import("@/server/storage");
const { db } = await import("@/server/db");
const { proxy } = await import("@/proxy");
const fileRoute = await import("@/app/s/[token]/f/[...path]/route");
const listRoute = await import("@/app/api/shares/route");
const idRoute = await import("@/app/api/shares/[id]/route");
const { SharePage } = await import("@/components/share/share-page");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
afterEach(() => {
  vi.restoreAllMocks();
  globalThis.__fuobeShareGuard = undefined;
});

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

/** A finished generation with a real output file; its input is an upload of its own. */
function made(prompt: string, feature = "grade") {
  const input = saveFile({ data: Buffer.concat([PNG, Buffer.from(`in ${prompt}`)]), contentType: "image/png", source: "upload" });
  const asset = saveFile({ data: Buffer.concat([PNG, Buffer.from(prompt)]), contentType: "image/png", source: "generation" });
  const g = gens.recordLocalGeneration({
    feature,
    modelId: "local-color-grade",
    op: "grade",
    prompt,
    inputs: { images: [input.url] },
    output: { url: asset.url, kind: "image", contentType: "image/png" },
  });
  db().prepare("UPDATE assets SET generation_id = ? WHERE id = ?").run(g.id, asset.id);
  return { g, rel: share.storedPath(asset.url)!, input: share.storedPath(input.url)! };
}

/** The files route's answer, read to the end (a file stream left open outlives the test's folder). */
async function serve(token: string, rel: string) {
  const res = await fileRoute.GET(new Request(`http://localhost/s/${token}/f/${rel}`), { params: Promise.resolve({ token, path: rel.split("/") }) });
  const body = Buffer.from(await res.arrayBuffer()).toString();
  return { status: res.status, headers: res.headers, body };
}

const req = (url: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(url, { method: init.method ?? "GET", headers: init.headers, ...(init.method === "POST" && { body: "{}" }) });
const passed = (r: Response) => r.headers.get("x-middleware-next") === "1";
const gone = (r: Response) => r.status === 404 && (r.headers.get("x-middleware-rewrite") ?? "").endsWith("/s/gone");

describe("share routes (pure)", () => {
  const token = "AbCdEfGhIjKl" + "m".repeat(32);

  it("opens exactly a share's page and a stored file under it", () => {
    expect(token).toHaveLength(share.SHARE_TOKEN_LENGTH);
    expect(share.shareRoute(`/s/${token}`)).toEqual({ token });
    expect(share.shareRoute(`/s/${token}/f/outputs/2026-10-26/abc_-1.png`)).toEqual({ token, file: "outputs/2026-10-26/abc_-1.png" });
    for (const p of [
      "/s",
      "/s/",
      `/s/${token}/`,
      `/s/${token}x`,
      `/s/${token.slice(1)}`,
      `/s/${token}/f`,
      `/s/${token}/f/`,
      `/s/${token}/other`,
      `/s/${token}/f/../db.sqlite`,
      `/s/${token}/f/outputs/../../fuobe.db`,
      `/s/${token}/f/.hidden`,
      `/s/${token}/f/outputs//x.png`,
      `/s/${token}/f/outputs/a%2F..%2Fb.png`,
      `/s/${token}/f/outputs/x.png/`,
      `/x/s/${token}`,
      "/s/gone",
      "/api/files/outputs/x.png",
    ]) {
      expect(share.shareRoute(p), p).toBeNull();
    }
  });

  it("maps stored files to share-scoped URLs and leaves other links out", () => {
    expect(share.storedPath("/api/files/outputs/d/a.png")).toBe("outputs/d/a.png");
    expect(share.storedPath("/api/files/outputs/d/a.png?download=x")).toBe("outputs/d/a.png");
    expect(share.storedPath("/api/files/../auth.json")).toBeNull();
    expect(share.storedPath("data:image/png;base64,AA")).toBeNull();
    expect(share.storedPath("https://fal.media/x.png")).toBeNull();
    expect(share.shareFileUrl(token, "/api/files/outputs/d/a.mp4")).toBe(`/s/${token}/f/outputs/d/a.mp4`);
    expect(share.outputFiles({ url: "/api/files/outputs/d/a.mp4", meta: { poster: "/api/files/outputs/d/p.png", preview: "https://x.example/p.png" } })).toEqual(["outputs/d/a.mp4", "outputs/d/p.png"]);
  });

  it("cleans tags, words expiry, and orders a Feature page by its cover", () => {
    expect(share.parseTags("#cinematic, Noir ,noir,, portrait")).toEqual(["cinematic", "Noir", "portrait"]);
    expect(share.parseTags(Array.from({ length: 12 }, (_, i) => `t${i}`))).toHaveLength(share.MAX_TAGS);
    const now = 1_000_000_000;
    expect(share.expiryLabel(null, now)).toBe("Never expires");
    expect(share.expiryLabel(now + 3 * 86_400_000, now)).toBe("Expires in 3 days");
    expect(share.expiryLabel(now + 5 * 3_600_000, now)).toBe("Expires in 5 hours");
    expect(share.expiryLabel(now - 2 * 86_400_000, now)).toBe("Expired 2 days ago");
    expect(share.expiryFrom(7, now)).toBe(now + 7 * 86_400_000);
    expect(share.expiryFrom(null, now)).toBeNull();
    const items = [{ key: "1" }, { key: "2" }, { key: "3" }];
    expect(share.orderForLayout(items, "feature", "3").map((i) => i.key)).toEqual(["3", "1", "2"]);
    expect(share.orderForLayout(items, "series", "3").map((i) => i.key)).toEqual(["1", "2", "3"]);
    expect(share.moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(share.moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
  });
});

describe("tokens", () => {
  it("stores only the token's hash and looks it up in constant time on the hash, hits and misses alike", () => {
    const { g } = made("a hashed lighthouse");
    const { share: s, token, path: p } = shares.createShare({ kind: "result", targetId: g.id });
    expect(p).toBe(`/s/${token}`);
    expect(share.isShareToken(token)).toBe(true);
    expect(s.id).toBe(token.slice(0, share.SHARE_ID_LENGTH));
    const row = db().prepare("SELECT * FROM shares WHERE id = ?").get(s.id) as ShareRow;
    expect(row.token_hash).toBe(crypto.createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(db().prepare("SELECT * FROM shares").all())).not.toContain(token.slice(share.SHARE_ID_LENGTH));

    const spy = vi.spyOn(crypto, "timingSafeEqual");
    expect(access.findShare(token)?.id).toBe(s.id);
    const wrongSecret = token.slice(0, share.SHARE_ID_LENGTH) + (token.at(-1) === "A" ? "B" : "A").repeat(32);
    expect(access.findShare(wrongSecret)).toBeNull();
    expect(access.findShare("Z".repeat(44))).toBeNull(); // no row with that id: compared against a dummy
    expect(spy).toHaveBeenCalledTimes(3);
    for (const [given, stored] of spy.mock.calls) {
      expect((given as Buffer).length).toBe(32);
      expect((stored as Buffer).length).toBe(32);
    }
    expect(spy.mock.calls[0][0]).toEqual(crypto.createHash("sha256").update(token).digest());
    // Malformed tokens never reach the database.
    expect(access.findShare("short")).toBeNull();
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("stops at its expiry", () => {
    const { g } = made("an expiring dune");
    const now = Date.now();
    const { token } = shares.createShare({ kind: "result", targetId: g.id, expiresInDays: 1 }, now);
    expect(access.findShare(token, now + 3_600_000)).not.toBeNull();
    expect(access.findShare(token, now + 2 * 86_400_000)).toBeNull();
  });
});

describe("what a token serves", () => {
  it("serves its own files only: never another share's, a request's input, or anything unshared", async () => {
    const a = made("share A canyon");
    const b = made("share B glacier");
    const loose = made("never shared harbour");
    const A = shares.createShare({ kind: "result", targetId: a.g.id });
    const B = shares.createShare({ kind: "result", targetId: b.g.id });

    const own = await serve(A.token, a.rel);
    expect(own.status).toBe(200);
    expect(own.body).toContain("share A canyon");
    expect(own.headers.get("x-robots-tag")).toMatch(/noindex/);
    expect(own.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await serve(B.token, b.rel)).status).toBe(200);

    expect((await serve(A.token, b.rel)).status).toBe(404);
    expect((await serve(B.token, a.rel)).status).toBe(404);
    expect((await serve(A.token, loose.rel)).status).toBe(404);
    expect((await serve(A.token, a.input)).status).toBe(404); // the run's input stays private
    expect((await serve(A.token, "outputs/../fuobe.db")).status).toBe(404);
    expect((await serve(A.token, "fuobe.db")).status).toBe(404);
    // A forged token with A's id but another secret opens nothing.
    expect((await serve(A.share.id + "x".repeat(32), a.rel)).status).toBe(404);
  });

  it("answers 404 once revoked, expired, or when the result went to the Trash", async () => {
    const r1 = made("revoked reef");
    const S1 = shares.createShare({ kind: "result", targetId: r1.g.id });
    expect(shares.revokeShare(S1.share.id)).toBe(true);
    expect((await serve(S1.token, r1.rel)).status).toBe(404);
    expect(access.findShare(S1.token)).toBeNull();

    const r2 = made("expired estuary");
    const S2 = shares.createShare({ kind: "result", targetId: r2.g.id, expiresInDays: 1 });
    db().prepare("UPDATE shares SET expires_at = ? WHERE id = ?").run(Date.now() - 1, S2.share.id);
    expect((await serve(S2.token, r2.rel)).status).toBe(404);

    const r3 = made("trashed tundra");
    const S3 = shares.createShare({ kind: "result", targetId: r3.g.id });
    lib.trashGenerations([r3.g.id]);
    expect((await serve(S3.token, r3.rel)).status).toBe(404);
    expect(access.shareTargetExists(access.findShare(S3.token)!)).toBe(false);
    lib.restoreGenerations([r3.g.id]);
    expect((await serve(S3.token, r3.rel)).status).toBe(200);
  });

  it("shares a folder with its subfolders, without the Trash or helper steps", async () => {
    const top = lib.createFolder({ name: "Shared top" });
    const sub = lib.createFolder({ name: "Shared sub", parentId: top.id });
    const other = lib.createFolder({ name: "Not shared" });
    const inTop = made("folder top fjord");
    const inSub = made("folder sub fjord");
    const helper = made("helper step fjord", "image-step");
    const trashed = made("trashed fjord");
    const elsewhere = made("other folder fjord");
    lib.moveToFolder([inTop.g.id, helper.g.id, trashed.g.id], top.id);
    lib.moveToFolder([inSub.g.id], sub.id);
    lib.moveToFolder([elsewhere.g.id], other.id);
    lib.trashGenerations([trashed.g.id]);

    const S = shares.createShare({ kind: "folder", targetId: top.id });
    expect(S.share.title).toBe("Shared top");
    const built = shares.buildPublicShare(access.findShare(S.token)!, S.token)!;
    expect(built.page.items).toHaveLength(2);
    expect([...built.files].sort()).toEqual([inTop.rel, inSub.rel].sort());
    expect((await serve(S.token, inSub.rel)).status).toBe(200);
    for (const x of [helper, trashed, elsewhere]) expect((await serve(S.token, x.rel)).status).toBe(404);
    // Moved out of the folder: no longer served.
    lib.moveToFolder([inSub.g.id], other.id);
    expect((await serve(S.token, inSub.rel)).status).toBe(404);
    // The folder deleted: the link is gone.
    lib.deleteFolder(top.id);
    expect(access.shareTargetExists(access.findShare(S.token)!)).toBe(false);
  });

  it("shares a Cinema project's takes", async () => {
    const p = cinema.createProject({ name: "Night shoot" });
    const take = made("cinema take alley");
    const outside = made("cinema outside alley");
    cinema.addItems(p.id, [take.g.id]);
    const S = shares.createShare({ kind: "cinema", targetId: p.id });
    expect(S.share.title).toBe("Night shoot");
    expect((await serve(S.token, take.rel)).status).toBe(200);
    expect((await serve(S.token, outside.rel)).status).toBe(404);
  });
});

describe("prompts", () => {
  it("leaves prompts (and titles made from them) out of a page whose Access says Prompts hidden", () => {
    const { g } = made("a secret prompt about violet tigers");
    const hidden = shares.createShare({ kind: "result", targetId: g.id, showPrompts: false });
    const page = shares.buildPublicShare(access.findShare(hidden.token)!, hidden.token)!.page;
    expect(JSON.stringify(page)).not.toMatch(/violet tigers/);
    expect(page.items[0].prompt).toBeUndefined();
    expect(page.items[0].model).toBe("Color Grading");
    const html = renderToStaticMarkup(createElement(SharePage, { share: page }));
    expect(html).not.toMatch(/violet tigers/);
    expect(html).not.toMatch(/Recreate in your Fuobe/);
    expect(html).toMatch(/Prompts hidden by the owner/);
    expect(html).not.toMatch(/\/api\/files\//); // every file through the share

    const shown = shares.createShare({ kind: "result", targetId: g.id, showPrompts: true });
    const page2 = shares.buildPublicShare(access.findShare(shown.token)!, shown.token)!.page;
    expect(page2.items[0].prompt).toBe("a secret prompt about violet tigers");
    // The caption doesn't say the prompt twice: the title names what was made, the prompt sits under it.
    expect(page2.items[0].title).not.toMatch(/violet tigers/);
    expect(page2.items[0].media[0].download).toMatch(/^a-secret-prompt-about-violet-tigers/);
    const html2 = renderToStaticMarkup(createElement(SharePage, { share: page2 }));
    expect(html2).toMatch(/violet tigers/);
    expect(html2).toMatch(/Recreate in your Fuobe/);
  });

  it("turns prompts off for an existing link", async () => {
    const { g } = made("prompt that gets hidden later: amber koi");
    const S = shares.createShare({ kind: "result", targetId: g.id, showPrompts: true });
    const res = await idRoute.PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ showPrompts: false }) }), { params: Promise.resolve({ id: S.share.id }) });
    expect(res.status).toBe(200);
    expect(JSON.stringify(shares.buildPublicShare(access.findShare(S.token)!, S.token)!.page)).not.toMatch(/amber koi/);
  });
});

describe("publish", () => {
  it("keeps the picked order, layout, cover, details, and refuses unfinished or unknown results", () => {
    const a = made("publish one");
    const b = made("publish two");
    const c = made("publish three");
    const P = shares.createShare({
      kind: "publish",
      items: [c.g.id, a.g.id, b.g.id],
      title: "  My  series ",
      description: "Three looks",
      tags: "#grade, Look, look",
      layout: "series",
      cover: { generationId: b.g.id, index: 0 },
      showPrompts: true,
    });
    expect(P.share).toMatchObject({ kind: "publish", title: "My series", tags: ["grade", "Look"], layout: "series", cover: { generationId: b.g.id, index: 0 }, showPrompts: true });
    const page = shares.buildPublicShare(access.findShare(P.token)!, P.token)!.page;
    expect(page.items.map((i) => i.prompt)).toEqual(["publish three", "publish one", "publish two"]);
    expect(page.coverKey).toBe("3");
    expect(page.cover?.url).toBe(`/s/${P.token}/f/${b.rel}`);
    expect(() => shares.createShare({ kind: "publish", items: [] })).toThrow(/at least one/);
    expect(() => shares.createShare({ kind: "publish", items: [a.g.id, "nope"] })).toThrow(/One result isn't finished/);
    expect(() => shares.createShare({ kind: "publish", items: [a.g.id], cover: { generationId: b.g.id, index: 0 } })).toThrow(/cover/);
    // A result taken to the Trash drops off the page; the rest stay.
    lib.trashGenerations([a.g.id]);
    expect(shares.buildPublicShare(access.findShare(P.token)!, P.token)!.page.items).toHaveLength(2);
  });
});

describe("the owner's API", () => {
  it("creates, lists, renews and revokes links", async () => {
    const { g } = made("api lagoon");
    const created = await listRoute.POST(new Request("http://localhost/api/shares", { method: "POST", body: JSON.stringify({ kind: "result", targetId: g.id, expiresInDays: 7 }) }));
    expect(created.status).toBe(201);
    const { share: s, token } = (await created.json()) as { share: { id: string; expiresAt: number }; token: string };
    expect(s.expiresAt).toBeGreaterThan(Date.now());
    const list = (await (await listRoute.GET()).json()) as { items: ShareListItem[]; signIn: boolean };
    const row = list.items.find((x) => x.id === s.id)!;
    expect(row).toMatchObject({ count: 1, gone: false, thumb: { kind: "image" } });
    expect(JSON.stringify(list)).not.toContain(token);
    expect(list.signIn).toBe(false);

    const bad = await listRoute.POST(new Request("http://localhost/api/shares", { method: "POST", body: JSON.stringify({ kind: "result", targetId: "missing" }) }));
    expect(bad.status).toBe(404);

    // A new link: the old token stops working, the new one works.
    const renewed = await idRoute.PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ newLink: true }) }), { params: Promise.resolve({ id: s.id }) });
    const r = (await renewed.json()) as { share: { id: string }; token: string };
    expect(access.findShare(token)).toBeNull();
    expect(access.findShare(r.token)?.id).toBe(r.share.id);

    const del = await idRoute.DELETE(new Request("http://localhost", { method: "DELETE" }), { params: Promise.resolve({ id: r.share.id }) });
    expect(del.status).toBe(204);
    expect(access.findShare(r.token)).toBeNull();
    expect((await idRoute.DELETE(new Request("http://localhost", { method: "DELETE" }), { params: Promise.resolve({ id: r.share.id }) })).status).toBe(404);
  });
});

describe("the sign-in proxy", () => {
  it("lets exactly a live share's page and files through without a session, and nothing else", () => {
    const { g, rel, input } = made("proxy pier");
    const S = shares.createShare({ kind: "result", targetId: g.id });
    auth.setPassword("correct horse battery");
    try {
      const page = proxy(req(`http://localhost:3000/s/${S.token}`));
      expect(passed(page)).toBe(true);
      expect(page.headers.get("x-robots-tag")).toMatch(/noindex/);
      expect(page.headers.get("referrer-policy")).toBe("no-referrer");
      expect(passed(proxy(req(`http://localhost:3000/s/${S.token}/f/${rel}`)))).toBe(true);
      expect(passed(proxy(req(`http://localhost:3000/s/${S.token}`, { method: "HEAD" })))).toBe(true);
      // The files route itself decides which files (the proxy passes the shape; see "what a token serves").
      expect(passed(proxy(req(`http://localhost:3000/s/${S.token}/f/${input}`)))).toBe(true);

      // Everything else still needs a session.
      expect(proxy(req(`http://localhost:3000/api/files/${rel}`)).status).toBe(401);
      expect(proxy(req("http://localhost:3000/api/shares")).status).toBe(401);
      expect(proxy(req(`http://localhost:3000/api/shares/${S.share.id}`, { method: "POST", headers: { origin: "http://localhost:3000" } })).status).toBe(401);
      for (const p of [`/s/${S.token}/other`, `/s/${S.token}/f/../../library`, "/s/gone", "/library", `/s/${S.token}x`]) {
        const r = proxy(req(`http://localhost:3000${p}`));
        expect(r.status, p).toBe(307);
        expect(r.headers.get("location"), p).toMatch(/\/login/);
      }
      // A share path written to (a server action, a form post) is not opened.
      expect(passed(proxy(req(`http://localhost:3000/s/${S.token}`, { method: "POST", headers: { origin: "http://localhost:3000" } })))).toBe(false);

      // Revoked or unknown: a real 404 (the "link unavailable" page), not a sign-in redirect.
      expect(gone(proxy(req(`http://localhost:3000/s/${"Q".repeat(44)}`)))).toBe(true);
      shares.revokeShare(S.share.id);
      expect(gone(proxy(req(`http://localhost:3000/s/${S.token}`)))).toBe(true);
      expect(gone(proxy(req(`http://localhost:3000/s/${S.token}/f/${rel}`)))).toBe(true);
    } finally {
      auth.setPassword(null);
    }
  });

  it("keeps the host allowlist and the cross-site check when no password is set", () => {
    const { g } = made("rebound pier");
    const S = shares.createShare({ kind: "result", targetId: g.id });
    expect(auth.authEnabled()).toBe(false);
    const rebound = proxy(new NextRequest(`http://rebind.attacker.example/s/${S.token}`, { headers: { host: "rebind.attacker.example" } }));
    expect(rebound.status).toBe(403);
    expect(passed(proxy(req(`http://localhost:3000/s/${S.token}`)))).toBe(true);
    expect(proxy(req(`http://localhost:3000/s/${S.token}`, { method: "POST", headers: { origin: "http://evil.example" } })).status).toBe(403);
  });

  it("rate-limits wrong tokens, but never the signed-in owner", () => {
    const { g } = made("guessed pier");
    const S = shares.createShare({ kind: "result", targetId: g.id });
    globalThis.__fuobeShareGuard = new access.ShareGuard({ perClient: 3, global: 5, windowMs: 60_000, lockMs: 60_000, maxClients: 100 });
    auth.setPassword("correct horse battery");
    try {
      for (let i = 0; i < 5; i++) expect(gone(proxy(req(`http://localhost:3000/s/${String(i).repeat(44)}`)))).toBe(true);
      const blocked = proxy(req(`http://localhost:3000/s/${S.token}`));
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(proxy(req(`http://localhost:3000/s/${"7".repeat(44)}`)).status).toBe(429);
      const cookie = `${auth.SESSION_COOKIE}=${auth.createSession().value}`;
      expect(passed(proxy(req(`http://localhost:3000/s/${S.token}`, { headers: { cookie } })))).toBe(true);
    } finally {
      auth.setPassword(null);
    }
  });
});

describe("ShareGuard", () => {
  const o = { perClient: 3, global: 10, windowMs: 60_000, lockMs: 60_000, maxClients: 100 };

  it("locks a trusted client after its misses, and everyone past the global budget", () => {
    const g = new access.ShareGuard(o);
    const t = 5_000_000;
    for (let i = 0; i < 2; i++) g.miss("1.2.3.4", false, t + i);
    expect(g.blockedFor("1.2.3.4", t + 5)).toBe(0);
    g.miss("1.2.3.4", false, t + 6);
    expect(g.blockedFor("1.2.3.4", t + 7)).toBeGreaterThan(50_000);
    expect(g.blockedFor("5.6.7.8", t + 7)).toBe(0);
    expect(g.blockedFor("1.2.3.4", t + 6 + 60_001)).toBe(0);
    // Rotating keys: the global budget still runs out, and then it's everyone.
    for (let i = 0; i < 10; i++) g.miss(`spoof-${i}`, false, t + 100 + i);
    expect(g.blockedFor("fresh", t + 200)).toBeGreaterThan(0);
    expect(g.blockedFor("fresh", t + 200 + 60_000)).toBe(0);
  });

  it("gives the shared key (no trusted proxy) only the global budget", () => {
    const g = new access.ShareGuard(o);
    const t = 9_000_000;
    for (let i = 0; i < 9; i++) g.miss("direct", true, t + i);
    expect(g.blockedFor("direct", t + 10)).toBe(0);
    g.miss("direct", true, t + 11);
    expect(g.blockedFor("direct", t + 12)).toBeGreaterThan(0);
  });
});
