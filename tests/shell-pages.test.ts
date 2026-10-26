import { describe, expect, it } from "vitest";
import { MODELS } from "@/lib/catalog";
import type { Generation } from "@/lib/catalog/types";
import { modelSearchText, toModelRow } from "@/lib/model-rows";
import { boardTitle, filmReady, rememberTitle, unwrapScene } from "@/lib/storyboard-board";

const frame = (i: number, extra: Partial<Generation> = {}, request: Record<string, unknown> = {}): Generation =>
  ({
    id: `g${i}`,
    feature: "storyboard",
    modelId: "nano-banana-pro",
    status: "succeeded",
    outputs: [{ url: `/api/files/x${i}.png`, kind: "image" }],
    request: { feature: "storyboard", modelId: "nano-banana-pro", prompt: `Frame ${i + 1} of a storyboard: …`, frame: { scene: `establishing wide shot: a lighthouse keeper finds a glowing bottle — beat ${i + 1} of 3`, index: i, of: 3 }, ...request },
    ...extra,
  }) as unknown as Generation;

describe("storyboard boards", () => {
  it("unwraps the offline shot list back to the idea", () => {
    expect(unwrapScene("close-up: a fox in the snow — beat 2 of 4")).toBe("a fox in the snow");
    expect(unwrapScene("A fox looks up at the moon.")).toBe("A fox looks up at the moon.");
  });

  it("titles a board with the user's idea first", () => {
    const frames = [frame(0), frame(1), frame(2)];
    expect(boardTitle(frames, "a lighthouse keeper finds a glowing bottle and follows its map")).toBe("A lighthouse keeper finds a glowing bottle and follows its map");
    // A title stored on the request (newer servers) wins over the browser's memory.
    expect(boardTitle([frame(0, {}, { title: "The keeper's bottle" })], "something else")).toBe("The keeper's bottle");
    // Without either, the first scene without its shot-list wrapping — never the internal frame prompt.
    expect(boardTitle(frames)).toBe("A lighthouse keeper finds a glowing bottle");
  });

  it("is ready for a film only when every frame is done", () => {
    expect(filmReady([frame(0), frame(1)])).toBe(true);
    expect(filmReady([frame(0), frame(1, { status: "running", outputs: [] })])).toBe(false);
    expect(filmReady([frame(0)])).toBe(false);
  });

  it("remembers a bounded number of ideas", () => {
    let map: Record<string, string> = {};
    for (let i = 0; i < 70; i++) map = rememberTitle(map, `b${i}`, `idea ${i}`);
    expect(Object.keys(map)).toHaveLength(60);
    expect(map.b69).toBe("idea 69");
    expect(map.b0).toBeUndefined();
  });
});

describe("model rows", () => {
  it("keeps only what the table shows", () => {
    const m = MODELS.find((x) => x.engine === "cloud" && x.pricing)!;
    const row = toModelRow(m);
    expect(Object.keys(row).sort()).toEqual(["badges", "engine", "engines", "id", "kind", "name", "ops", "price", "routes", "tagline", "vendor"]);
    expect(row.routes.every((r) => /^[a-z]+: /.test(r))).toBe(true);
    expect(row.badges).not.toContain("open");
    expect(JSON.stringify(row)).not.toMatch(/"map"|fieldMap|"defaults"/);
  });

  it("prices open models as free and shrinks the payload", () => {
    const open = MODELS.find((x) => x.engine === "open" && !x.engines)!;
    expect(toModelRow(open).price).toBe("Free");
    // A Fuobe Original is free on the GPU and priced on the cloud.
    const original = MODELS.find((x) => x.engines?.length === 2)!;
    expect(toModelRow(original).price).toMatch(/^Free · .+ \/ megapixel$/);
    const full = JSON.stringify(MODELS).length;
    const slim = JSON.stringify(MODELS.map(toModelRow)).length;
    expect(slim / full).toBeLessThan(0.5);
  });

  it("searches name, vendor, tagline and what it can do", () => {
    const row = toModelRow(MODELS[0]);
    expect(modelSearchText(row)).toContain(row.name.toLowerCase());
    expect(modelSearchText(row)).toContain(row.ops[0].toLowerCase());
  });
});
