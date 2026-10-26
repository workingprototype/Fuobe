// Where the harness keeps things, and how a case file's input paths resolve. Inputs the repo can't
// ship live in scripts/eval/local/ (git-ignored); tiny synthetic fixtures in scripts/eval/fixtures/.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EVAL_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const REPO_DIR = path.resolve(EVAL_DIR, "../..");
export const CASES_DIR = path.join(EVAL_DIR, "cases");
export const LOCAL_DIR = path.join(EVAL_DIR, "local");
export const FIXTURES_DIR = path.join(EVAL_DIR, "fixtures");
export const METRICS_DIR = path.join(EVAL_DIR, "metrics");
export const RESEARCH_DIR = path.join(REPO_DIR, "docs/research");

/** Results: --out, else FUOBE_EVAL_RESULTS, else scripts/eval/results (git-ignored). */
export const resultsDir = (env = process.env, out) => path.resolve(out ?? env.FUOBE_EVAL_RESULTS ?? path.join(EVAL_DIR, "results"));

/** A reference the server reads itself: one of its files or a public link (never uploaded again). */
export const isRemote = (ref) => /^https?:\/\//i.test(ref) || ref.startsWith("/api/files/");

/**
 * A case file's path, made absolute: `local/…` (your own inputs, never committed), `fixtures/…`
 * (synthetic files for demo runs), `samples/…` (public/samples, the demo clips the app ships), an
 * absolute path, or a path relative to the case file. Links and /api/files/… URLs stay as they are.
 */
export function resolveInput(ref, suiteDir = CASES_DIR) {
  if (isRemote(ref)) return ref;
  if (path.isAbsolute(ref)) return ref;
  const [head, ...rest] = ref.split("/");
  if (head === "local") return path.join(LOCAL_DIR, ...rest);
  if (head === "fixtures") return path.join(FIXTURES_DIR, ...rest);
  if (head === "samples") return path.join(REPO_DIR, "public/samples", ...rest);
  return path.resolve(suiteDir, ref);
}

const MEDIA = /\.(png|jpe?g|webp|gif|bmp|mp4|mov|m4v|webm|wav|mp3|flac|ogg|m4a)$/i;

/** The media files a path names: the file itself, or a folder's files (sorted, not recursive, no dot-files). */
export function listMedia(abs) {
  let st;
  try {
    st = fs.statSync(abs);
  } catch {
    return [];
  }
  if (st.isFile()) return [abs];
  return fs
    .readdirSync(abs)
    .filter((n) => !n.startsWith(".") && MEDIA.test(n))
    .sort()
    .map((n) => path.join(abs, n));
}

/** A name safe for a file: letters, digits, dot, dash and underscore only. */
export const safeName = (s) => String(s).replace(/[^\w.-]+/g, "_").replace(/^\.+/, "_").slice(0, 180);
