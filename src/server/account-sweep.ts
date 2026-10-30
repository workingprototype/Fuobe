import "server-only";
import fs from "node:fs";
import path from "node:path";
import { RETENTION_MS, runAccountDeletedHooks } from "./account-files";
import { clearAccountLoras } from "./account-loras";
import { listAccounts } from "./auth";
import { db } from "./db";
import { deleteForever } from "./library";
import { deleteAsset, scratchDir } from "./storage";

/**
 * Public sign-up: what an account keeps on this server goes in time. Its uploads after 14 days (even when a run still
 * names them: a file can't be kept alive for ever), its runs and their files after 30, and everything at once when the
 * account is deleted. Runs at boot, then daily (src/instrumentation.ts).
 */

const DAY = 24 * 60 * 60_000;
/** An upload's temp file left behind (the server stopped mid-upload). */
const STALE_UPLOAD_MS = 60 * 60_000;

/** Every account that owns a run or a file here. */
function owners(): string[] {
  const runs = db()
    .prepare("SELECT DISTINCT json_extract(request_json, '$.account') AS id FROM generations WHERE json_extract(request_json, '$.account') IS NOT NULL")
    .all() as { id: string }[];
  const files = db().prepare("SELECT DISTINCT account_id AS id FROM assets WHERE account_id IS NOT NULL").all() as { id: string }[];
  return [...new Set([...runs, ...files].map((r) => r.id).filter(Boolean))];
}

/**
 * Remove a deleted account's runs (running ones are cancelled first) and files, then run the cleanups other features
 * registered (account-files.ts onAccountDeleted).
 */
export async function purgeAccount(id: string): Promise<{ runs: number; files: number }> {
  const runIds = (db().prepare("SELECT id FROM generations WHERE json_extract(request_json, '$.account') = ?").all(id) as { id: string }[]).map((r) => r.id);
  let runs = 0;
  for (let i = 0; i < runIds.length; i += 200) runs += await deleteForever(runIds.slice(i, i + 200));
  const files = (db().prepare("SELECT id FROM assets WHERE account_id = ?").all(id) as { id: string }[]).map((r) => r.id);
  for (const f of files) deleteAsset(f);
  clearAccountLoras(id);
  await runAccountDeletedHooks(id);
  return { runs, files: files.length };
}

/** One sweep (see the header). `now` for tests. */
export async function sweepAccountFiles(now = Date.now()): Promise<{ uploads: number; runs: number; files: number; accounts: number }> {
  // Uploads past their time.
  const uploads = db()
    .prepare("SELECT id FROM assets WHERE account_id IS NOT NULL AND source = 'upload' AND created_at < ?")
    .all(now - RETENTION_MS.upload) as { id: string }[];
  for (const u of uploads) deleteAsset(u.id);
  // Runs past their time (not one still going), with their files.
  const old = (
    db()
      .prepare("SELECT id FROM generations WHERE json_extract(request_json, '$.account') IS NOT NULL AND created_at < ? AND status NOT IN ('queued', 'running')")
      .all(now - RETENTION_MS.run) as { id: string }[]
  ).map((r) => r.id);
  let runs = 0;
  for (let i = 0; i < old.length; i += 200) runs += await deleteForever(old.slice(i, i + 200));
  // Results kept for a run another one named, once both are gone.
  const orphans = db()
    .prepare(
      "SELECT id FROM assets WHERE account_id IS NOT NULL AND source != 'upload' AND created_at < ? AND (generation_id IS NULL OR generation_id NOT IN (SELECT id FROM generations))",
    )
    .all(now - RETENTION_MS.run) as { id: string }[];
  for (const o of orphans) deleteAsset(o.id);
  // Accounts that are gone.
  const live = new Set(listAccounts().map((a) => a.id));
  const gone = owners().filter((id) => !live.has(id));
  for (const id of gone) await purgeAccount(id);
  // Upload temp files the server left behind.
  try {
    const dir = scratchDir();
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith("up-")) continue;
      const file = path.join(dir, f);
      try {
        if (now - fs.statSync(file).mtimeMs > STALE_UPLOAD_MS) fs.rmSync(file, { force: true });
      } catch {}
    }
  } catch {}
  return { uploads: uploads.length, runs, files: orphans.length, accounts: gone.length };
}

declare global {
  var __fuobeAccountSweep: { timer: NodeJS.Timeout } | undefined;
}

/** Sweep now, then every day (once per process). */
export function ensureAccountSweep(): void {
  if (globalThis.__fuobeAccountSweep) return;
  const run = () => void sweepAccountFiles().catch((e) => console.warn(`[fuobe] account sweep failed: ${(e as Error).message}`));
  const timer = setInterval(run, DAY);
  timer.unref?.();
  globalThis.__fuobeAccountSweep = { timer };
  run();
}
