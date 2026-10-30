/**
 * The audit log (docs/research/accounts-8.md §7.14): audit() takes who acted, from where and with which browser from
 * the request scope, never records a secret, and appends to a hash-chained table that refuses UPDATE and DELETE.
 * verifyAuditChain() answers "Records verified up to {time}" or "The record changed after {time}".
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-audit-"));
process.env.FUOBE_DATA_DIR = dir;
const { db } = await import("@/server/db");
const { audit, auditDenied, verifyAuditChain } = await import("@/server/access/audit");
const { withScope, runAs, asSystem, LOCAL_OWNER } = await import("@/server/access/actor");
const { appendAudit } = await import("@/server/identity/audit-log");
const { actor, asNobody } = await import("./helpers/actors");
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

interface Row {
  seq: number;
  at: number;
  actor_id: string | null;
  actor_via: string | null;
  action: string;
  target_kind: string | null;
  target_id: string | null;
  meta_json: string;
  ip: string | null;
  user_agent: string | null;
}
const last = () => db().prepare("SELECT * FROM audit_log ORDER BY seq DESC LIMIT 1").get() as Row;

describe("audit()", () => {
  it("records the acting person, their address and browser from the request scope", () => {
    const person = actor("u_alex", "member", { via: "token", tokenId: "t1" });
    withScope({ actor: person, ip: "203.0.113.7", userAgent: "curl/8", method: "PUT", path: "/api/settings" }, () =>
      audit("install.setting_changed", { kind: "setting", id: "engine.mode" }, { from: "both", to: "open" }),
    );
    const row = last();
    expect(row).toMatchObject({ action: "install.setting_changed", actor_id: "u_alex", actor_via: "token", target_kind: "setting", target_id: "engine.mode", ip: "203.0.113.7", user_agent: "curl/8" });
    expect(JSON.parse(row.meta_json)).toEqual({ tokenId: "t1", from: "both", to: "open" });
  });

  it("names the runner's row owner, the server, and the real person behind a view-as", () => {
    runAs({ ...LOCAL_OWNER, via: "runner" }, () => audit("generation.settled"));
    expect(last()).toMatchObject({ actor_id: "u_owner", actor_via: "runner", ip: null });
    asSystem(() => audit("housekeeping.swept"));
    expect(last()).toMatchObject({ actor_id: "system", actor_via: "system" });
    runAs(actor("u_alex", "member", { impersonatorId: "u_owner" }), () => audit("content.viewed"));
    expect(JSON.parse(last().meta_json)).toEqual({ impersonator: "u_owner" });
  });

  it("records nobody when no one is acting (a public route answered for nobody)", () => {
    asNobody();
    audit("auth.sign_in_failed", null, { reason: "wrong password" });
    expect(last()).toMatchObject({ actor_id: null, actor_via: null });
  });

  it("never writes a secret, whatever the caller passed", () => {
    audit("keys.changed", null, {
      setting: "fal.key",
      apiKey: "sk-live-123",
      password: "hunter2",
      nested: { client_secret: "abc", authorization: "Bearer x", tokenPrefix: "fuobe_abcd" },
      tokenId: "keep-me",
      prefix: "sk-li…",
    });
    const meta = JSON.parse(last().meta_json);
    expect(meta).toEqual({
      setting: "fal.key",
      apiKey: "[redacted]",
      password: "[redacted]",
      nested: { client_secret: "[redacted]", authorization: "[redacted]", tokenPrefix: "fuobe_abcd" },
      tokenId: "keep-me",
      prefix: "sk-li…",
    });
    expect(last().meta_json).not.toMatch(/sk-live|hunter2|Bearer x/);
  });

  it("records a denial with the route and the reason", () => {
    withScope({ actor: actor("u_alex"), method: "POST", path: "/api/loras" }, () => auditDenied("FORBIDDEN"));
    expect(last().action).toBe("denied");
    expect(JSON.parse(last().meta_json)).toEqual({ method: "POST", path: "/api/loras", reason: "FORBIDDEN" });
  });
});

describe("the append-only, hash-chained table", () => {
  it("refuses UPDATE and DELETE", () => {
    const { seq } = last();
    expect(() => db().prepare("UPDATE audit_log SET action = 'x' WHERE seq = ?").run(seq)).toThrow(/append-only/);
    expect(() => db().prepare("DELETE FROM audit_log WHERE seq = ?").run(seq)).toThrow(/append-only/);
    expect(() => db().exec("DELETE FROM audit_log")).toThrow(/append-only/);
    expect(last().seq).toBe(seq);
  });

  it("verifies up to the last row", () => {
    for (let i = 0; i < 5; i++) audit("test.entry", { kind: "n", id: String(i) });
    const check = verifyAuditChain();
    const rows = (db().prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n;
    expect(check).toEqual({ ok: true, rows, verifiedUpTo: last().at });
  });

  it("chains each row to the one before it (prev_hash is the previous row's hash)", () => {
    const rows = db().prepare("SELECT prev_hash, hash FROM audit_log ORDER BY seq").all() as { prev_hash: string; hash: string }[];
    expect(rows[0].prev_hash).toBe("");
    for (let i = 1; i < rows.length; i++) expect(rows[i].prev_hash).toBe(rows[i - 1].hash);
  });

  it("keeps the bare writer and audit() on one chain", () => {
    appendAudit({ action: "auth.sign_in", actorId: "u_owner", via: "session" });
    audit("token.created", { kind: "token", id: "t2" });
    const [a, b] = (db().prepare("SELECT prev_hash, hash FROM audit_log ORDER BY seq DESC LIMIT 2").all() as { prev_hash: string; hash: string }[]).reverse();
    expect(b.prev_hash).toBe(a.hash);
    expect(verifyAuditChain().ok).toBe(true);
  });

  // Someone with the database file can lift a trigger; the chain still tells.
  const behindTheTriggers = (trigger: "audit_log_append_only" | "audit_log_no_delete", sql: string, seq: number) => {
    const create = (db().prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(trigger) as { sql: string }).sql;
    db().exec(`DROP TRIGGER ${trigger}`);
    try {
      db().prepare(sql).run(seq);
    } finally {
      db().exec(create);
    }
  };

  it("finds a row changed behind the triggers' back, and says from when", () => {
    const rows = db().prepare("SELECT seq, at FROM audit_log ORDER BY seq").all() as { seq: number; at: number }[];
    behindTheTriggers("audit_log_append_only", `UPDATE audit_log SET meta_json = '{"to":"edited"}' WHERE seq = ?`, rows[3].seq);
    const check = verifyAuditChain();
    expect(check).toEqual({ ok: false, rows: 3, verifiedUpTo: rows[2].at, brokenAt: { seq: rows[3].seq, at: rows[3].at } });
  });

  it("finds a row removed from the middle (earlier than the change, so that is where it breaks now)", () => {
    const rows = db().prepare("SELECT seq, at FROM audit_log ORDER BY seq").all() as { seq: number; at: number }[];
    behindTheTriggers("audit_log_no_delete", "DELETE FROM audit_log WHERE seq = ?", rows[1].seq);
    const check = verifyAuditChain();
    expect(check).toEqual({ ok: false, rows: 1, verifiedUpTo: rows[0].at, brokenAt: { seq: rows[2].seq, at: rows[2].at } });
    // The triggers are back.
    expect(() => db().prepare("DELETE FROM audit_log WHERE seq = ?").run(rows[0].seq)).toThrow(/append-only/);
  });
});
