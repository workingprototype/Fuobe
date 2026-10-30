/**
 * The route sweep (docs/research/accounts-8.md §13): every route handler under src/app goes through handler()
 * (src/server/access/route.ts), so each request resolves who is asking and checks what the route declares. A new
 * route.ts that exports a bare function fails here, by file and method.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// Importing every route module once is slow under a parallel run.
vi.setConfig({ testTimeout: 180_000 });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-route-sweep-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const { isWrapped } = await import("@/server/access/route");

const ROOT = path.resolve(__dirname, "..");
const METHODS = ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"];

function routeFiles(d = path.join(ROOT, "src/app")): string[] {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) return routeFiles(p);
    return /^route\.(ts|tsx|js|mjs)$/.test(e.name) ? [p] : [];
  });
}

const FILES = routeFiles();
const rel = (f: string) => path.relative(ROOT, f);

describe("every route goes through handler()", () => {
  it("finds the routes (192 at 545ebb5; more since)", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(192);
  });

  it("exports no bare handler: each method is `export const X = handler(…)` or a const made by handler()", () => {
    const bad: string[] = [];
    for (const f of FILES) {
      const src = fs.readFileSync(f, "utf8");
      const name = rel(f);
      for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+(GET|HEAD|OPTIONS|POST|PUT|PATCH|DELETE)\b/g)) bad.push(`${name}: function ${m[1]}`);
      for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
        for (const part of m[1].split(",")) {
          const exported = part.trim().split(/\s+as\s+/).pop()?.trim();
          if (exported && METHODS.includes(exported)) bad.push(`${name}: export { … as ${exported} }`);
        }
      }
      for (const m of src.matchAll(/export\s+const\s+(GET|HEAD|OPTIONS|POST|PUT|PATCH|DELETE)\s*=\s*([^;\n]*)/g)) {
        const rhs = m[2].trim();
        if (rhs.startsWith("handler(")) continue;
        const alias = /^([A-Za-z_$][\w$]*)\s*;?$/.exec(rhs)?.[1];
        if (alias && new RegExp(`const\\s+${alias}\\s*=\\s*handler\\(`).test(src)) continue;
        bad.push(`${name}: ${m[1]} = ${rhs.slice(0, 40)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("every exported method of every route module is a handler() wrapper", async () => {
    const bad: string[] = [];
    for (const f of FILES) {
      const mod = (await import(f)) as Record<string, unknown>;
      const methods = METHODS.filter((m) => m in mod);
      if (!methods.length) bad.push(`${rel(f)}: exports no method`);
      for (const m of methods) if (!isWrapped(mod[m])) bad.push(`${rel(f)}: ${m}`);
    }
    expect(bad).toEqual([]);
  });

  it("names the four install-config routes as needing install.settings", () => {
    const needs = (file: string, method: string) =>
      new RegExp(`export\\s+const\\s+${method}\\s*=\\s*handler\\(\\{\\s*access:\\s*"perm:install\\.settings"`).test(fs.readFileSync(path.join(ROOT, file), "utf8"));
    expect(needs("src/app/api/settings/route.ts", "PUT")).toBe(true);
    expect(needs("src/app/api/settings/models/route.ts", "PUT")).toBe(true);
    expect(needs("src/app/api/providers/test/route.ts", "POST")).toBe(true);
    expect(needs("src/app/api/loras/route.ts", "POST")).toBe(true);
  });

  it("keeps the public routes few: sign-in, sign-out, Better Auth's router and share files", () => {
    const open = FILES.filter((f) => /access:\s*"public"/.test(fs.readFileSync(f, "utf8"))).map(rel).sort();
    expect(open).toEqual([
      "src/app/api/auth/login/route.ts",
      "src/app/api/auth/logout/route.ts",
      "src/app/api/identity/[...all]/route.ts",
      "src/app/s/[token]/f/[...path]/route.ts",
    ]);
  });
});
