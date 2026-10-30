/**
 * Who may call what (docs/research/accounts-8.md §7.1, §7.3): handler() resolves an actor for every route, the four
 * install-config routes need install.settings (the Personal owner and Just me on this computer pass, a member is
 * refused), token scopes narrow what a token may call, typed refusals become 404 / 403 / 401 / 402 / 403 REAUTH,
 * every 403 is audited, restricted sessions only reach their own routes, the substituteActor seam keeps the real
 * person, and the role, permission and team-role registries answer as the plan says.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

// Real scrypt hashes (N=2^15) for the password case: slow under a parallel run.
vi.setConfig({ testTimeout: 60_000 });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-access-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
for (const k of ["FUOBE_PASSWORD", "FUOBE_OWNER_PASSWORD", "FUOBE_SIGNIN", "FUOBE_MODE", "FUOBE_SECRET", "FUOBE_TRUST_PROXY", "FUOBE_TRUSTED_PROXIES", "FUOBE_SITE_URL"]) delete process.env[k];

const { db } = await import("@/server/db");
const { bootstrapIdentity } = await import("@/server/identity/bootstrap");
const { handler, registerActorSubstitute, registerRestrictedKind, restrictedAllows, routePattern } = await import("@/server/access/route");
const { currentActor, maybeActor, LOCAL_OWNER, runAs, SYSTEM } = await import("@/server/access/actor");
const errors = await import("@/server/access/errors");
const perms = await import("@/server/access/permissions");
const { gate, gateRefusal, registerGate } = await import("@/server/access/gates");
const { seedPerson, seedTeam, tokenFor, request, actor, asNobody, updatePerson } = await import("./helpers/actors");
const { setOwnerPassword, ownerCookie } = await import("./helpers/identity");
const settingsRoute = await import("@/app/api/settings/route");
const modelsRoute = await import("@/app/api/settings/models/route");
const providersTest = await import("@/app/api/providers/test/route");
const lorasRoute = await import("@/app/api/loras/route");
const tokensRoute = await import("@/app/api/auth/tokens/route");
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

await bootstrapIdentity();

interface AuditRow {
  seq: number;
  action: string;
  actor_id: string | null;
  actor_via: string | null;
  meta_json: string;
}
const lastAudit = () => db().prepare("SELECT * FROM audit_log ORDER BY seq DESC LIMIT 1").get() as AuditRow;
const auditCount = (action: string) => (db().prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = ?").get(action) as { n: number }).n;

const member = seedPerson({ role: "member" });
const admin = seedPerson({ role: "admin" });

/** The four install-config calls, each with a body their handler answers 400 to (nothing changes, nothing is fetched). */
const CONFIG: [string, (o: { bearer?: string; cookie?: string }) => Promise<Response>][] = [
  ["PUT /api/settings", (o) => settingsRoute.PUT(request("/api/settings", { method: "PUT", body: { nope: 1 }, ...o }))],
  ["PUT /api/settings/models", (o) => modelsRoute.PUT(request("/api/settings/models", { method: "PUT", body: {}, ...o }))],
  ["POST /api/providers/test", (o) => providersTest.POST(request("/api/providers/test", { body: { provider: "nope" }, ...o }))],
  ["POST /api/loras", (o) => lorasRoute.POST(request("/api/loras", { body: {}, ...o }))],
];

describe("install-config routes need install.settings", () => {
  it("lets Just me on this computer through", async () => {
    for (const [name, call] of CONFIG) expect([200, 400], name).toContain((await call({})).status);
  });

  it("refuses a member with 403, audited as denied with the route and the reason", async () => {
    const token = tokenFor(member);
    for (const [name, call] of CONFIG) {
      const before = auditCount("denied");
      const res = await call({ bearer: token });
      expect(res.status, name).toBe(403);
      expect(await res.json()).toMatchObject({ code: "FORBIDDEN" });
      expect(auditCount("denied"), name).toBe(before + 1);
      const row = lastAudit();
      expect(row).toMatchObject({ action: "denied", actor_id: member, actor_via: "token" });
      const [method, p] = name.split(" ");
      expect(JSON.parse(row.meta_json)).toMatchObject({ method, path: p, reason: "FORBIDDEN" });
    }
  });

  it("lets an admin and the owner's Full or Admin tokens through, but not a Generate or Read token", async () => {
    for (const bearer of [tokenFor(admin), tokenFor("u_owner"), tokenFor("u_owner", ["admin"])]) {
      for (const [name, call] of CONFIG) expect([200, 400], name).toContain((await call({ bearer })).status);
    }
    for (const scopes of [["generate"], ["read"]]) {
      const res = await settingsRoute.PUT(request("/api/settings", { method: "PUT", body: {}, bearer: tokenFor("u_owner", scopes) }));
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "TOKEN_SCOPE" });
    }
  });

  it("lets the Personal owner through when signed in, and nobody without a session or token", async () => {
    await setOwnerPassword("correct horse battery");
    try {
      const cookie = await ownerCookie("correct horse battery");
      for (const [name, call] of CONFIG) expect([200, 400], name).toContain((await call({ cookie })).status);
      for (const [name, call] of CONFIG) expect((await call({})).status, name).toBe(401);
      expect((await settingsRoute.PUT(request("/api/settings", { method: "PUT", body: {}, bearer: "fuobe_wrong" }))).status).toBe(401);
    } finally {
      await setOwnerPassword(null);
    }
  });

  it("keeps reads open to every signed-in person", async () => {
    expect((await settingsRoute.GET(request("/api/settings", { bearer: tokenFor(member, ["read"]) }))).status).toBe(200);
  });
});

describe("token scopes and browser-only routes", () => {
  it("lets a Read token read but not write", async () => {
    const read = tokenFor("u_owner", ["read"]);
    const echo = handler({}, () => Response.json({ ok: true }));
    expect((await echo(request("/x", { bearer: read }))).status).toBe(200);
    const res = await echo(request("/x", { method: "POST", body: {}, bearer: read }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "TOKEN_SCOPE" });
  });

  it("keeps API tokens out of token management", async () => {
    const res = await tokensRoute.GET(request("/api/auth/tokens", { bearer: tokenFor("u_owner") }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "BROWSER_ONLY" });
    expect((await tokensRoute.GET(request("/api/auth/tokens"))).status).toBe(200);
  });
});

describe("handler()", () => {
  it("runs the route as the resolved actor, with the address and browser in the scope", async () => {
    let seen: unknown;
    const who = handler({}, () => {
      seen = currentActor();
      return Response.json({});
    });
    await runAs(SYSTEM, () => who(request("/x")));
    expect(seen).toEqual(LOCAL_OWNER);
    await who(request("/x", { bearer: tokenFor(member) }));
    expect(seen).toMatchObject({ userId: member, role: "member", via: "token" });
  });

  it("answers a public route for nobody, and every other route 401", async () => {
    await setOwnerPassword("correct horse battery");
    try {
      let seen: unknown = "unset";
      const open = handler({ access: "public" }, () => {
        seen = maybeActor();
        return Response.json({});
      });
      expect((await open(request("/x"))).status).toBe(200);
      expect(seen).toBeNull();
      const closed = handler({}, () => Response.json({}));
      const res = await closed(request("/x"));
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toMatch(/Bearer/);
    } finally {
      await setOwnerPassword(null);
    }
  });

  it("maps typed refusals to 404, 403, 401, 402 and 403 REAUTH, auditing each 403", async () => {
    const cases: [Error, number, string | undefined][] = [
      [new errors.NotFoundError(), 404, undefined],
      [new errors.ForbiddenError("No.", "NOPE"), 403, "NOPE"],
      [new errors.UnauthenticatedError(), 401, undefined],
      [new errors.PaymentRequiredError(), 402, "LIMIT_REACHED"],
      [new errors.ReauthRequiredError(), 403, "REAUTH"],
    ];
    for (const [e, status, code] of cases) {
      const before = auditCount("denied");
      const res = await handler({}, () => {
        throw e;
      })(request("/refuse", { method: "POST", body: {} }));
      expect(res.status, e.name).toBe(status);
      const body = (await res.json()) as { error: string; code?: string };
      expect(body.error).toBe(e.message);
      expect(body.code).toBe(code);
      expect(auditCount("denied"), e.name).toBe(before + (status === 403 ? 1 : 0));
      if (status === 403) expect(JSON.parse(lastAudit().meta_json)).toMatchObject({ reason: code, path: "/refuse", method: "POST" });
    }
  });

  it("audits a 403 the route answers itself, and lets other errors through as before", async () => {
    const before = auditCount("denied");
    expect((await handler({}, () => Response.json({ error: "no" }, { status: 403 }))(request("/self"))).status).toBe(403);
    expect(auditCount("denied")).toBe(before + 1);
    await expect(
      handler({}, () => {
        throw new Error("boom");
      })(request("/boom")),
    ).rejects.toThrow("boom");
  });

  it("audits a hidden record's 404 at most once a minute per person and route", async () => {
    const hidden = handler({}, () => {
      throw new errors.NotFoundError("Not found", true);
    });
    const before = auditCount("denied.hidden");
    for (let i = 0; i < 3; i++) expect((await hidden(request("/hidden/1"))).status).toBe(404);
    expect(auditCount("denied.hidden")).toBe(before + 1);
    await hidden(request("/hidden/1", { bearer: tokenFor(member) }));
    expect(auditCount("denied.hidden")).toBe(before + 2);
  });

  it("refuses an unknown permission when the route is declared", () => {
    expect(() => handler({ access: "perm:nope.nothing" }, () => new Response())).toThrow(/Unknown permission/);
  });

  it("treats a restricted session outside its kind's routes as signed out", () => {
    registerRestrictedKind("accept-terms", (p) => p.startsWith("/api/terms"));
    expect(restrictedAllows("accept-terms", "/api/terms/accept", "POST")).toBe(true);
    expect(restrictedAllows("accept-terms", "/api/settings", "PUT")).toBe(false);
    expect(restrictedAllows("enroll-2fa", "/api/terms/accept", "POST")).toBe(false);
  });

  it("acts as a substituted person (view-as), keeping the real one and making it read-only", async () => {
    const viewed = seedPerson({ role: "member" });
    registerActorSubstitute((a, req) => (req.headers.get("x-test-view-as") === viewed ? { ...a, userId: viewed, role: "member" } : null));
    let seen: ReturnType<typeof currentActor> | undefined;
    const who = handler({}, () => {
      seen = currentActor();
      return Response.json({});
    });
    await who(request("/x", { headers: { "x-test-view-as": viewed } }));
    expect(seen).toMatchObject({ userId: viewed, impersonatorId: "u_owner" });
    expect(perms.can(seen, "install.settings")).toBe(false);
    const res = await settingsRoute.PUT(request("/api/settings", { method: "PUT", body: {}, headers: { "x-test-view-as": viewed } }));
    expect(res.status).toBe(403);
    expect(JSON.parse(lastAudit().meta_json)).toMatchObject({ impersonator: "u_owner" });
  });
});

describe("roles and permissions", () => {
  it("gives the owner everything, an admin the day-to-day permissions, a member none", () => {
    for (const p of perms.permissions()) expect(perms.roleCan("owner", p), p).toBe(true);
    expect(perms.roleCan("admin", "install.settings")).toBe(true);
    for (const p of ["install.mode", "people.roles", "support.view_as", "credits.adjust"]) expect(perms.roleCan("admin", p), p).toBe(false);
    for (const p of perms.permissions()) expect(perms.roleCan("member", p), p).toBe(false);
    expect(perms.roleCan("nobody", "install.settings")).toBe(false);
  });

  it("lets packages register roles and permissions (a family grant covers its names), but never replace the owner", () => {
    perms.registerPermission("billing.refund");
    perms.registerRole("billing", { label: "Billing", rank: 40, grants: ["billing.*"] });
    expect(perms.permissionExists("billing.refund")).toBe(true);
    expect(perms.roleCan("billing", "billing.refund")).toBe(true);
    expect(perms.roleCan("billing", "install.settings")).toBe(false);
    expect(perms.roles().map((r) => r.name)).toEqual(["owner", "admin", "billing", "member"]);
    expect(() => perms.registerRole("owner", { label: "Owner", rank: 1, grants: [] })).toThrow();
  });

  it("answers can() for the server, tokens and nobody", () => {
    expect(perms.can(SYSTEM, "install.mode")).toBe(true);
    expect(perms.can(null, "install.settings")).toBe(false);
    expect(perms.can(LOCAL_OWNER, "install.settings")).toBe(true);
    expect(perms.can(actor("u_owner", "owner", { via: "token", scopes: ["generate"] }), "install.settings")).toBe(false);
    expect(perms.can(actor(admin, "admin", { via: "token", scopes: ["admin"] }), "install.settings")).toBe(true);
  });

  it("answers team roles through effectiveTeamRole only, with clamps that only lower", () => {
    const viewer = seedPerson();
    const team = seedTeam("Studio A", { [admin]: "admin", [member]: "member", [viewer]: "viewer" });
    const as = (id: string, o = {}) => actor(id, "member", o);
    expect(perms.effectiveTeamRole(as(admin), team)).toBe("admin");
    expect(perms.effectiveTeamRole(as(member), team)).toBe("member");
    expect(perms.effectiveTeamRole(as(viewer), team)).toBe("viewer");
    expect(perms.effectiveTeamRole(as("u_owner"), team)).toBeNull();
    expect(perms.effectiveTeamRole(LOCAL_OWNER, "w_owner")).toBe("owner");
    expect(perms.effectiveTeamRole(SYSTEM, team)).toBe("owner");
    // View-as is read-only.
    expect(perms.effectiveTeamRole(as(admin, { impersonatorId: "u_owner" }), team)).toBe("viewer");
    // A view-only seat is a Viewer; a clamp that tries to raise is ignored.
    perms.registerTeamRoleClamp((a, _w, role) => (a.userId === member ? "viewer" : role));
    perms.registerTeamRoleClamp((a, _w, role) => (a.userId === viewer ? "owner" : role));
    expect(perms.effectiveTeamRole(as(member), team)).toBe("viewer");
    expect(perms.effectiveTeamRole(as(viewer), team)).toBe("viewer");
    expect(perms.teamRoleAtLeast("admin", "member")).toBe(true);
    expect(perms.teamRoleAtLeast("viewer", "member")).toBe(false);
    expect(perms.TEAM_ROLE_LABEL.member).toBe("Editor");
  });
});

describe("gates", () => {
  it("are open in the core, and refuse with a 403 once a package registers a check", () => {
    expect(gateRefusal("share.create", LOCAL_OWNER)).toBeNull();
    expect(() => gate("share.create", LOCAL_OWNER)).not.toThrow();
    registerGate("share.create", (a) => (a.role === "member" ? { code: "PLAN", message: "Your plan doesn't include share links." } : null));
    expect(() => gate("share.create", actor(member))).toThrow(errors.ForbiddenError);
    expect(gateRefusal("share.create", LOCAL_OWNER)).toBeNull();
  });
});

describe("the test harness", () => {
  let inBeforeAll: string | undefined;
  beforeAll(() => {
    inBeforeAll = maybeActor()?.userId;
  });

  it("runs every test as the local owner, from beforeAll on", async () => {
    expect(inBeforeAll).toBe("u_owner");
    await new Promise((r) => setTimeout(r, 1));
    expect(currentActor()).toEqual(LOCAL_OWNER);
  });

  it("acts as nobody after asNobody(): currentActor() throws", async () => {
    asNobody();
    await Promise.resolve();
    expect(maybeActor()).toBeNull();
    expect(() => currentActor()).toThrow(/No one is acting/);
  });

  it("is the local owner again in the next test", () => {
    expect(currentActor().userId).toBe("u_owner");
  });
});

describe("denials that can't flood the log", () => {
  it("writes a public route's own 403 for nobody at most once a minute per address and route, counting the rest", async () => {
    await setOwnerPassword("correct horse battery");
    try {
      // Better Auth's router answers 403 to every endpoint it keeps closed.
      const blocked = handler({ access: "public" }, () => Response.json({ error: "blocked" }, { status: 403 }));
      const send = (o: { bearer?: string } = {}) => blocked(request("/api/identity/sign-up/email", { method: "POST", body: {}, ...o }));
      const before = auditCount("denied");
      for (let i = 0; i < 20; i++) expect((await send()).status).toBe(403);
      expect(auditCount("denied")).toBe(before + 1);
      expect(lastAudit()).toMatchObject({ actor_id: null });
      // A signed-in person's 403s are each written.
      const token = tokenFor(member);
      for (let i = 0; i < 3; i++) await send({ bearer: token });
      expect(auditCount("denied")).toBe(before + 4);
      // A minute on, the next one is written and says how many were held back.
      vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ["Date"] });
      try {
        await send();
      } finally {
        vi.useRealTimers();
      }
      expect(auditCount("denied")).toBe(before + 5);
      expect(JSON.parse(lastAudit().meta_json)).toMatchObject({ path: "/api/identity/sign-up/email", reason: "route", more: 19 });
    } finally {
      await setOwnerPassword(null);
    }
  });

  it("counts hidden-record 404s per person and route, not per id", async () => {
    const hidden = handler({}, async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
      await ctx.params;
      throw new errors.NotFoundError("Not found", true);
    });
    const before = auditCount("denied.hidden");
    for (let i = 0; i < 50; i++) expect((await hidden(request(`/api/generations/id-${i}`), { params: Promise.resolve({ id: `id-${i}` }) })).status).toBe(404);
    expect(auditCount("denied.hidden")).toBe(before + 1);
    expect(JSON.parse(lastAudit().meta_json)).toMatchObject({ path: "/api/generations/id-0" });
  });

  it("names a route's dynamic segments from the params Next matched", async () => {
    expect(await routePattern("/api/generations/g_1", { params: Promise.resolve({ id: "g_1" }) })).toBe("/api/generations/[id]");
    expect(await routePattern("/s/tok/f/a/b%20c.png", { params: Promise.resolve({ token: "tok", path: ["a", "b c.png"] }) })).toBe("/s/[token]/f/[...path]");
    expect(await routePattern("/api/settings", undefined)).toBe("/api/settings");
  });

  it("audits a turned-off person's refused credentials under their name", async () => {
    const off = seedPerson({ role: "member" });
    const token = tokenFor(off);
    updatePerson(off, { status: "disabled" });
    const echo = handler({}, () => Response.json({}));
    const before = auditCount("denied");
    const res = await echo(request("/api/mcp", { method: "POST", body: {}, bearer: token }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "ACCOUNT_DISABLED" });
    expect(auditCount("denied")).toBe(before + 1);
    expect(lastAudit()).toMatchObject({ actor_id: off, actor_via: "token" });
    expect(JSON.parse(lastAudit().meta_json)).toMatchObject({ reason: "ACCOUNT_DISABLED", path: "/api/mcp", method: "POST" });
  });
});

describe("refusals the studios pass on", () => {
  it("answers a refusal thrown inside a studio's error helper with its status, and audits each 403", async () => {
    const cinema = await import("@/server/cinema-schemas");
    const faceless = await import("@/server/faceless");
    const factory = await import("@/server/content-factory");
    const shorts = await import("@/server/shorts-schemas");
    const { failure } = await import("@/server/marketing");
    const { recipeFailure } = await import("@/server/recipe-routes");
    const caught = (answer: (e: unknown) => Response) => (fn: () => never) => {
      try {
        return fn();
      } catch (e) {
        return answer(e);
      }
    };
    const wrappers: [string, (fn: () => never) => Response | Promise<Response>][] = [
      ["cinema", cinema.handle],
      ["faceless", faceless.handle],
      ["content factory", factory.handle],
      ["shorts", shorts.handle],
      ["marketing", caught(failure)],
      ["recipes", caught(recipeFailure)],
    ];
    const refusals: [Error, number][] = [
      [new errors.ForbiddenError("No.", "NOPE"), 403],
      [new errors.NotFoundError(), 404],
      [new errors.PaymentRequiredError(), 402],
      [new errors.ReauthRequiredError(), 403],
    ];
    for (const [name, wrap] of wrappers) {
      for (const [e, status] of refusals) {
        const before = auditCount("denied");
        const res = await handler({}, () =>
          wrap(() => {
            throw e;
          }),
        )(request(`/studio/${name.replace(/ /g, "-")}`, { method: "POST", body: {} }));
        expect(res.status, `${name}: ${e.name}`).toBe(status);
        expect(((await res.json()) as { error: string }).error, `${name}: ${e.name}`).toBe(e.message);
        expect(auditCount("denied"), `${name}: ${e.name}`).toBe(before + (status === 403 ? 1 : 0));
      }
      // Anything else is still the studio's own answer.
      const own = await handler({}, () =>
        wrap(() => {
          throw new Error("Pick a clip first");
        }),
      )(request("/studio/own", { method: "POST", body: {} }));
      expect([422, 500], name).toContain(own.status);
    }
  });
});
