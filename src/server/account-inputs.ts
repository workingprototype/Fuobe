import "server-only";
import fs from "node:fs";
import type { GenerationRequest } from "@/lib/catalog/types";
import { fileAccount } from "./account-library";
import { absolutePath, GONE_MESSAGE, NOT_YOURS_MESSAGE } from "./storage";

/**
 * The files an account's run names (public sign-up, "Your GPU"): only files it uploaded here, or its own results. No
 * links (the server never fetches one for an account), no data: URIs (stored inline in the run), no asset ids, and
 * never someone else's file. Checked by the run route before anything is queued; storage.ts guardRef checks again when
 * a step reads its inputs. None of these answers is a GPU setup problem.
 */

export type InputProblem = { status: 400 | 403 | 404; code: "input-not-allowed" | "input-not-yours" | "input-gone"; error: string };

export const INPUT_NOT_ALLOWED = "Upload the file here first. Runs on your GPU use files you uploaded.";

const notAllowed: InputProblem = { status: 400, code: "input-not-allowed", error: INPUT_NOT_ALLOWED };

/** A string in params.extra that names a file (the slots there take a stored file, a link or a data: URI). */
const looksLikeFile = (v: string) => /^(data:|https?:\/\/|\/api\/files\/)/i.test(v.trim());

/** One stored file named by an account's run: fine (null), gone, or someone else's. */
function checkFile(ref: string, accountId: string): InputProblem | null {
  if (!ref.startsWith("/api/files/")) return notAllowed;
  let rel: string;
  try {
    rel = decodeURIComponent(ref.slice("/api/files/".length).split("?")[0]);
  } catch {
    return { status: 404, code: "input-gone", error: GONE_MESSAGE };
  }
  const owner = fileAccount(rel);
  if (owner === undefined) return { status: 404, code: "input-gone", error: GONE_MESSAGE };
  if (owner !== accountId) return { status: 403, code: "input-not-yours", error: NOT_YOURS_MESSAGE };
  try {
    if (!fs.statSync(absolutePath(rel)).isFile()) return { status: 404, code: "input-gone", error: GONE_MESSAGE };
  } catch {
    return { status: 404, code: "input-gone", error: GONE_MESSAGE };
  }
  return null;
}

/**
 * The first problem with the files an account's run names, or null. Every value in `inputs` is a file; in
 * `params.extra`, every top-level string (or list of strings) that names one.
 */
export function accountInputProblem(req: Pick<GenerationRequest, "inputs" | "params">, accountId: string): InputProblem | null {
  const refs: string[] = [];
  for (const v of Object.values(req.inputs ?? {})) {
    if (v === undefined || v === null) continue;
    const list = Array.isArray(v) ? v : [v];
    for (const x of list) {
      if (typeof x !== "string") return notAllowed;
      if (x) refs.push(x);
    }
  }
  for (const v of Object.values(req.params?.extra ?? {})) {
    const list = typeof v === "string" ? [v] : Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : [];
    refs.push(...list.filter(looksLikeFile));
  }
  for (const ref of refs) {
    const problem = checkFile(ref.trim(), accountId);
    if (problem) return problem;
  }
  return null;
}
