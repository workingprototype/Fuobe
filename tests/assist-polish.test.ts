import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { HUB_MODES } from "@/lib/hubs";
// Plain .mjs helper shared with the Playwright scripts.
import { dynamicSamples, hubModePaths, studioRoutes } from "./e2e/_routes.mjs";

const root = process.cwd();
// The proxy reads the sign-in settings from the data folder: use an empty one (no password).
process.env.FUOBE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-polish-"));

describe("/apps/<unknown> is a real 404", () => {
  it("the proxy rewrites unknown app ids to the not-found page with status 404", async () => {
    delete process.env.FUOBE_PASSWORD;
    const { proxy } = await import("@/proxy");
    const unknown = proxy(new NextRequest("http://localhost:3000/apps/does-not-exist"));
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("x-middleware-rewrite")).toMatch(/\/_fuobe-not-found$/);
    const known = proxy(new NextRequest("http://localhost:3000/apps/app-packshot"));
    expect(known.status).toBe(200);
    expect(known.headers.get("x-middleware-rewrite")).toBeNull();
    expect(proxy(new NextRequest("http://localhost:3000/apps")).headers.get("x-middleware-rewrite")).toBeNull();
    // A malformed escape doesn't crash the proxy.
    expect(proxy(new NextRequest("http://localhost:3000/apps/%E0%A4%A")).status).toBe(404);
  });
});

describe("the 390 px sweep visits dynamic routes", () => {
  it("finds every dynamic route and has a sample for each", () => {
    const { routes, patterns } = studioRoutes(root) as { routes: string[]; patterns: string[] };
    expect(routes).toContain("/assist/skills");
    expect(patterns).toEqual(expect.arrayContaining(["/audio/[mode]", "/video-tools/[mode]", "/upscale/[mode]", "/cinema/[id]", "/canvas/[id]", "/apps/[id]", "/assist/projects/[id]"]));
    const { urls, unsampled } = dynamicSamples(root, { cinema: "c1", canvas: "v1", assistProject: "p1" }) as { urls: string[]; unsampled: string[] };
    expect(unsampled).toEqual([]);
    expect(urls).toEqual(expect.arrayContaining(["/cinema/c1", "/cinema/does-not-exist", "/canvas/v1", "/canvas/does-not-exist", "/assist/projects/p1", "/apps/does-not-exist"]));
  });

  it("reads every hub mode from src/lib/hubs.ts (the first mode is the hub's own page)", () => {
    const expected = Object.entries(HUB_MODES).flatMap(([hub, modes]) => modes.slice(1).map((m) => `/${hub}/${m.id}`));
    expect((hubModePaths(root) as string[]).sort()).toEqual(expected.sort());
  });
});

describe("Cinema uses the shared live stream", () => {
  it("opens no EventSource of its own", () => {
    const src = fs.readFileSync(path.join(root, "src/components/cinema/hooks.ts"), "utf8");
    expect(src).not.toMatch(/new EventSource/);
    expect(src).toMatch(/useGenerationEvents/);
  });
});
