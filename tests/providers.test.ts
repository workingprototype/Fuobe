import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ModelDef, ModelRoute } from "@/lib/catalog/types";

// Provider adapters read their keys from the settings table: give them a throwaway database.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-providers-"));
process.env.FUOBE_DATA_DIR = dir;

const { higgsfieldProvider } = await import("@/server/providers/higgsfield");
const { falProvider } = await import("@/server/providers/fal");
const { replicateProvider } = await import("@/server/providers/replicate");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Answer fetches from a table of URL → JSON body, in order of registration. */
async function withFetch<T>(answers: Record<string, unknown>, fn: () => Promise<T>): Promise<{ result: T; urls: string[] }> {
  const real = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    urls.push(u);
    const hit = Object.keys(answers).find((k) => u.startsWith(k));
    if (!hit) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(answers[hit]), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    return { result: await fn(), urls };
  } finally {
    globalThis.fetch = real;
  }
}

const model = { id: "m", routes: [] } as unknown as ModelDef;
const ctx = (route: Partial<ModelRoute>, meta: Record<string, unknown> = {}) => ({
  externalId: "req-1",
  meta,
  route: { op: "t2i", provider: "fal", endpoint: "x", ...route } as ModelRoute,
  model,
  createdAt: 0,
});

describe("Higgsfield poll (S1)", () => {
  it("returns only the media of a completed RequestStatus, not its status/cancel links", async () => {
    const statusUrl = "https://api.higgsfield.ai/requests/req-1/status";
    // RequestStatus as docs.higgsfield.ai/docs/openapi.json documents it.
    const body = {
      status: "completed",
      request_id: "req-1",
      status_url: statusUrl,
      cancel_url: "https://api.higgsfield.ai/requests/req-1/cancel",
      images: [{ url: "https://cdn.higgsfield.ai/out/a.png" }],
    };
    const { result } = await withFetch({ [statusUrl]: body }, () =>
      higgsfieldProvider.poll(ctx({ provider: "higgsfield", endpoint: "higgsfield-ai/soul/v2/standard" }, { statusUrl })),
    );
    expect(result).toEqual({ state: "succeeded", outputs: [{ url: "https://cdn.higgsfield.ai/out/a.png", kind: "image" }] });
  });

  it("keeps videos first and extra artifacts as links on the output", async () => {
    const statusUrl = "https://api.higgsfield.ai/requests/req-2/status";
    const body = {
      status: "completed",
      request_id: "req-2",
      status_url: statusUrl,
      cancel_url: "https://api.higgsfield.ai/requests/req-2/cancel",
      video: { url: "https://cdn.higgsfield.ai/out/v.mp4" },
      zip: { url: "https://cdn.higgsfield.ai/out/frames.zip" },
    };
    const { result } = await withFetch({ [statusUrl]: body }, () => higgsfieldProvider.poll(ctx({ provider: "higgsfield", op: "t2v" }, { statusUrl })));
    expect(result).toEqual({
      state: "succeeded",
      outputs: [{ url: "https://cdn.higgsfield.ai/out/v.mp4", kind: "video", meta: { artifacts: { zip: "https://cdn.higgsfield.ai/out/frames.zip" } } }],
    });
  });

  it("fails cleanly when a completed status has no media", async () => {
    const statusUrl = "https://api.higgsfield.ai/requests/req-3/status";
    const body = { status: "completed", request_id: "req-3", status_url: statusUrl, cancel_url: "https://api.higgsfield.ai/requests/req-3/cancel" };
    const { result } = await withFetch({ [statusUrl]: body }, () => higgsfieldProvider.poll(ctx({ provider: "higgsfield" }, { statusUrl })));
    expect(result.state).toBe("failed");
  });
});
