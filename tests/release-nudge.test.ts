import fs from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
 * The studios' "is here" card for the newest open model (src/components/studio/release-nudge.tsx, src/lib/release-nudge.ts):
 * its release is the one Home shows (src/lib/home-release.ts), it offers the model only where the viewer can run it, and
 * the static shell renders nothing (the browser's "Not now" is read after hydration).
 */

vi.mock("next/cache", () => ({ cacheLife: () => {} }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => {}, push: () => {}, replace: () => {}, back: () => {}, refresh: () => {} }),
  usePathname: () => "/image",
  useSearchParams: () => new URLSearchParams(),
}));

const { RELEASE_NUDGE, nudgeKey, releaseRunsFor } = await import("@/lib/release-nudge");
const { HOME_RELEASE } = await import("@/lib/home-release");
const { getModel } = await import("@/lib/catalog");
const { IMAGE_STUDIO, EDIT_STUDIO, INPAINT_STUDIO } = await import("@/lib/studios");
const { ReleaseNudge } = await import("@/components/studio/release-nudge");
const { CatalogProvider } = await import("@/components/studio/catalog");
const { StudioProvider } = await import("@/components/studio/studio-context");
const { initialDraft } = await import("@/components/studio/draft");
const { studioCatalog } = await import("@/lib/studio-catalog");

const model = getModel(HOME_RELEASE.modelId)!;
const owner = (o: Record<string, unknown> = {}) => ({ providers: { comfyui: { configured: true } }, engineMode: "both" as const, ...o });
const visitor = (v: Record<string, unknown>, o: Record<string, unknown> = {}) => ({ providers: {}, engineMode: "both" as const, viewer: { gpu: { connected: false }, ...v }, ...o });
const runs = (status: Parameters<typeof releaseRunsFor>[0]["status"], more: Partial<Parameters<typeof releaseRunsFor>[0]> = {}) =>
  releaseRunsFor({ status, here: null, model, offered: true, vramGb: RELEASE_NUDGE.vramGb, ...more });

describe("the latest release's data", () => {
  it("is the model Home shows, an open image model that makes pictures from words and edits", () => {
    expect(model).toMatchObject({ name: HOME_RELEASE.name, engine: "open", kind: "image" });
    expect(model.routes.map((r) => r.op).sort()).toEqual(["edit", "t2i"]);
    expect(model.defaults).toMatchObject({ resolution: "2K" });
    // The Prompt helper stays off unless asked.
    expect(model.options.controls?.find((c) => c.param === "promptHelper")?.default ?? "off").toBe("off");
    // "Not now" is per release: the next model or day is a new key.
    expect(nudgeKey()).toBe(`fuobe:release-nudge:${HOME_RELEASE.modelId}:${HOME_RELEASE.released}`);
    expect(nudgeKey({ modelId: "oss-next", released: "2027-01-03" })).not.toBe(nudgeKey());
    expect(RELEASE_NUDGE.art).toHaveLength(3);
    for (const slug of RELEASE_NUDGE.art) expect(HOME_RELEASE.art.map((a) => a.slug)).toContain(slug);
    // The lane's need is the requirements index's.
    const index = JSON.parse(fs.readFileSync(path.join(process.cwd(), "workflows/comfyui/requirements.json"), "utf8")) as { workflows: Record<string, { vramGb: number }> };
    for (const r of model.routes) expect(index.workflows[r.endpoint].vramGb, r.endpoint).toBe(RELEASE_NUDGE.vramGb);
  });

  it("is shown in the Image and Edit studios, each with its own line, and nowhere else", () => {
    expect(IMAGE_STUDIO.releaseNudge).toBe("image");
    expect(EDIT_STUDIO.releaseNudge).toBe("edit");
    expect(INPAINT_STUDIO.releaseNudge).toBeUndefined();
    for (const line of Object.values(RELEASE_NUDGE.lines)) {
      expect(line.length).toBeGreaterThan(30);
      // Plain and positive: no prices, no refusals.
      expect(line).not.toMatch(/\$|can't|cannot|isn't|not available/i);
    }
  });
});

describe("who the card offers the model to", () => {
  it("the owner whose ComfyUI is connected, on an install that runs open models", () => {
    expect(runs(owner())).toBe(true);
    expect(runs(owner({ engineMode: "open" }))).toBe(true);
    expect(runs(owner({ engineMode: "cloud" }))).toBe(false);
    expect(runs(owner({ providers: {} }))).toBe(false);
    // On the workers, only while one of them runs it.
    expect(runs(owner(), { here: { owner: true, rules: {} } })).toBe(true);
    expect(runs(owner(), { here: { owner: true, rules: { own: { [model.id]: { need: "gpu" } as never } } } })).toBe(false);
  });

  it("a guest or an account whose runs go to this install's GPUs, while they run it", () => {
    const pooled = visitor({ kind: "guest", hosted: true });
    expect(runs(pooled, { here: { owner: false, rules: {} } })).toBe(true);
    expect(runs(pooled, { here: { owner: false, rules: { deny: [model.id] } } })).toBe(false);
    expect(runs(visitor({ kind: "account", hosted: true }), { here: { owner: false, rules: { kinds: { image: false } } } })).toBe(false);
  });

  it("an account on its own GPU: when it is connected and, where its size is known, large enough", () => {
    expect(runs(visitor({ kind: "account", gpu: { connected: true, vramBytes: 32 * 2 ** 30 } }))).toBe(true);
    // An RTX 5090 reads a little under 32 GiB.
    expect(runs(visitor({ kind: "account", gpu: { connected: true, vramBytes: 31.5 * 2 ** 30 } }))).toBe(true);
    expect(runs(visitor({ kind: "account", gpu: { connected: true } }))).toBe(true);
    expect(runs(visitor({ kind: "account", gpu: { connected: true, vramBytes: 24 * 2 ** 30 } }))).toBe(false);
    expect(runs(visitor({ kind: "account", gpu: { connected: false } }))).toBe(false);
    expect(runs(visitor({ kind: "guest" }))).toBe(false);
  });

  it("nobody while the status is unknown or the model is switched off", () => {
    expect(runs(undefined)).toBe(false);
    expect(runs(owner(), { offered: false })).toBe(false);
    expect(runs(owner(), { model: undefined })).toBe(false);
  });
});

describe("the card in the studio", () => {
  it("renders nothing in the static shell, so the first render after hydration matches it", () => {
    const catalog = studioCatalog(IMAGE_STUDIO);
    const draft = initialDraft(IMAGE_STUDIO, new URLSearchParams(), "open", { getModel, getPreset: () => undefined });
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(CatalogProvider, {
          catalog,
          config: IMAGE_STUDIO,
          children: createElement(StudioProvider, { config: IMAGE_STUDIO, initial: draft, children: createElement(ReleaseNudge, { studio: "image" }) }),
        }),
      ),
    );
    expect(html).toBe("");
  });
});
