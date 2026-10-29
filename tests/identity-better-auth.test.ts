/**
 * Better Auth behind Fuobe (docs/research/accounts-8.md §5.2, §7.1): pins of the pinned version's behaviour that
 * Fuobe relies on — cookie names and attributes, IP tracking, the router-only allowlist, create intents reaching
 * database hooks, returnHeaders, the internal adapter — and the schema guard. A library upgrade that changes any
 * of these fails here first.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-ba-"));
process.env.FUOBE_DATA_DIR = dir;
for (const k of ["FUOBE_PASSWORD", "FUOBE_OWNER_PASSWORD", "FUOBE_SITE_URL", "FUOBE_TRUST_PROXY", "FUOBE_TRUSTED_PROXIES", "FUOBE_SECRET", "FUOBE_MODE", "FUOBE_SIGNIN"]) delete process.env[k];

const identity = await import("@/server/identity/auth");
const { db } = await import("@/server/db");
const { bootstrapIdentity } = await import("@/server/identity/bootstrap");
const { setOwnerPassword, cookieHeader } = await import("./helpers/identity");
const { OWNER_EMAIL, ownerAuthUserId } = await import("@/server/identity/owner");
const route = await import("@/app/api/identity/[...all]/route");
const { getMigrations } = await import("better-auth/db/migration");
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const PASSWORD = "correct horse battery";
await bootstrapIdentity();
await setOwnerPassword(PASSWORD);

const authUsers = () => (db().prepare("SELECT COUNT(*) AS n FROM auth_user").get() as { n: number }).n;

/** A browser request to Better Auth's router, from this site. */
const routerPost = (p: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost:3000/api/identity${p}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000", host: "localhost:3000", ...headers },
    body: JSON.stringify(body),
  });

describe("the schema guard", () => {
  it("finds nothing to create or add: Better Auth's tables are frozen in Fuobe's migrations", async () => {
    const m = await getMigrations(identity.getAuth().options);
    expect(m.toBeCreated.map((t) => t.table)).toEqual([]);
    expect(m.toBeAdded.map((t) => `${t.table}: ${Object.keys(t.fields).join(", ")}`)).toEqual([]);
    expect(m.toBeAddedIndexes.map((i) => i.name)).toEqual([]);
  });
});

describe("cookies (§7.1)", () => {
  it("are fuobe.* without Secure on plain http", async () => {
    const auth = identity.createFuobeAuth({ siteUrl: null, trustedProxy: false });
    const { headers } = await auth.api.signInEmail({ body: { email: OWNER_EMAIL, password: PASSWORD }, headers: new Headers(), returnHeaders: true });
    const session = headers.getSetCookie().find((c) => c.startsWith("fuobe.session_token="))!;
    expect(session).toBeTruthy();
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Lax/i);
    expect(session).toMatch(/Path=\//);
    expect(session).not.toMatch(/Secure/i);
    expect(session).not.toMatch(/Domain=/i);
  });

  it("are __Host-fuobe.* with Secure, Path=/ and no Domain on an https site address (never __Secure-)", async () => {
    const auth = identity.createFuobeAuth({ siteUrl: "https://studio.example.com", trustedProxy: false });
    const { headers } = await auth.api.signInEmail({ body: { email: OWNER_EMAIL, password: PASSWORD }, headers: new Headers(), returnHeaders: true });
    const all = headers.getSetCookie();
    const session = all.find((c) => c.startsWith("__Host-fuobe.session_token="))!;
    expect(session, all.join("\n")).toBeTruthy();
    expect(session).toMatch(/; Secure/i);
    expect(session).toMatch(/Path=\//);
    expect(session).not.toMatch(/Domain=/i);
    expect(all.some((c) => c.startsWith("__Secure-"))).toBe(false);
    expect(identity.sessionCookieName({ siteUrl: "https://studio.example.com", trustedProxy: false })).toBe("__Host-fuobe.session_token");
    expect(identity.sessionCookieName({ siteUrl: null, trustedProxy: false })).toBe("fuobe.session_token");
  });

  it("returnHeaders hands back the Set-Cookie lines, and the cookie names a live session", async () => {
    const { headers, response } = await identity.getAuth().api.signInEmail({ body: { email: OWNER_EMAIL, password: PASSWORD }, headers: new Headers(), returnHeaders: true });
    expect(response.user.email).toBe(OWNER_EMAIL);
    const session = await identity.getAuth().api.getSession({ headers: new Headers({ cookie: cookieHeader(headers.getSetCookie()) }) });
    expect(session?.user.id).toBe(ownerAuthUserId());
    // GET stays read-only (deferSessionRefresh): it reports instead of writing.
    expect(session).toHaveProperty("needsRefresh", false);
  });
});

describe("the router allowlist (§7.1)", () => {
  it("answers 403 to sign-up from a browser and creates no user", async () => {
    const before = authUsers();
    const res = await route.POST(routerPost("/sign-up/email", { email: "someone@example.com", password: "another long password", name: "Someone" }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe("ENDPOINT_BLOCKED");
    expect(authUsers()).toBe(before);
  });

  it("blocks social sign-in, OAuth callbacks and the always-blocked list, and lets the allowlist through", async () => {
    for (const p of ["/sign-in/social", "/sign-in/oauth2", "/sign-in/email", "/delete-user", "/list-sessions", "/revoke-sessions", "/change-email", "/get-access-token"]) {
      expect(identity.routerAllows(p), p).toBe(false);
      // 403 from the allowlist, or 404 where no plugin defines the path at all.
      expect([403, 404], p).toContain((await route.POST(routerPost(p, {}))).status);
    }
    for (const p of ["/get-session", "/sign-out", "/update-user", "/ok"]) expect(identity.routerAllows(p), p).toBe(true);
    expect((await route.GET(new Request("http://localhost:3000/api/identity/ok", { headers: { host: "localhost:3000" } }))).status).toBe(200);
  });

  it("lets Fuobe's own auth.api calls pass the allowlist: their creates meet the create-intent check instead", async () => {
    const before = authUsers();
    // No request, so the allowlist doesn't apply; no intent, so user.create.before refuses.
    await expect(identity.getAuth().api.signUpEmail({ body: { email: "second@example.com", password: "another long password", name: "Second" } })).rejects.toMatchObject({
      body: { code: "SIGN_UP_CLOSED" },
    });
    expect(authUsers()).toBe(before);
  });

  it("carries Fuobe's request scope into database hooks: a create under an intent goes through, and its session check still runs", async () => {
    const before = authUsers();
    // The owner is already linked, so the new user gets a pending person of its own (never active), and the
    // sign-in that sign-up attempts is refused with that code. Better Auth's transactions are off: the user stays.
    await expect(
      identity.withCreateIntent("claim-owner", () => identity.getAuth().api.signUpEmail({ body: { email: "scope-check@example.com", password: "another long password", name: "Scope" } })),
    ).rejects.toMatchObject({ body: { code: "ACCOUNT_PENDING" } });
    expect(authUsers()).toBe(before + 1);
    const person = db().prepare("SELECT u.status, u.source FROM users u JOIN auth_user a ON a.id = u.auth_user_id WHERE a.email = ?").get("scope-check@example.com");
    expect(person).toEqual({ status: "pending", source: "unknown" });
  });

  it("refuses a session for a pending person with its code", async () => {
    await expect(identity.getAuth().api.signInEmail({ body: { email: "scope-check@example.com", password: "another long password" } })).rejects.toMatchObject({
      body: { code: "ACCOUNT_PENDING" },
    });
  });

  it("strips the picture and caps the name on /update-user", async () => {
    const { headers } = await identity.getAuth().api.signInEmail({ body: { email: OWNER_EMAIL, password: PASSWORD }, headers: new Headers(), returnHeaders: true });
    const cookie = cookieHeader(headers.getSetCookie());
    const ok = await route.POST(routerPost("/update-user", { name: "Mina", image: "https://evil.example/x.png" }, { cookie }));
    expect(ok.status).toBe(200);
    const row = db().prepare("SELECT name, image FROM auth_user WHERE id = ?").get(ownerAuthUserId()) as { name: string; image: string | null };
    expect(row).toEqual({ name: "Mina", image: null });
    const long = await route.POST(routerPost("/update-user", { name: "x".repeat(81) }, { cookie }));
    expect(long.status).toBe(400);
  });
});

describe("client IPs (§7.1, §7.2)", () => {
  const tries = async (auth: ReturnType<typeof identity.createFuobeAuth>, headers: Record<string, string>) => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await auth.handler(routerPost("/sign-in/email", { email: `x${i}@example.com`, password: "nope nope nope" }, headers))).status);
    return statuses;
  };

  it("without a trusted proxy, tracking is off and the limiter skips its IP rules (no shared bucket to fill)", async () => {
    const statuses = await tries(identity.createFuobeAuth({ siteUrl: null, trustedProxy: false }), { "x-fuobe-client-ip": "203.0.113.7" });
    expect(statuses).not.toContain(429);
  });

  it("behind a trusted proxy, the limiter keys on x-fuobe-client-ip", async () => {
    const statuses = await tries(identity.createFuobeAuth({ siteUrl: null, trustedProxy: true }), { "x-fuobe-client-ip": "203.0.113.8" });
    expect(statuses).toContain(429);
    // Another client still gets in.
    const other = await identity.createFuobeAuth({ siteUrl: null, trustedProxy: true }).handler(routerPost("/get-session", {}, { "x-fuobe-client-ip": "198.51.100.9" }));
    expect(other.status).not.toBe(429);
  });
});

describe("admin operations (§7.1)", () => {
  it("can reach Better Auth's internal adapter and the methods admin-ops.ts uses", async () => {
    const ctx = await identity.getAuth().$context;
    for (const m of ["createUser", "findUserByEmail", "findUserById", "findCredentialAccount", "updatePassword", "linkAccount", "deleteAccount", "deleteUserSessions", "listSessions", "deleteSession", "updateUser", "deleteAccounts", "deleteUser"] as const) {
      expect(typeof ctx.internalAdapter[m], m).toBe("function");
    }
  });
});
