import { describe, expect, it } from "vitest";
import { getModel } from "@/lib/catalog";
import { framePrompt, heuristicScenes, parseScenes, STORYBOARD_MODELS } from "@/lib/catalog/storyboard";

describe("storyboard", () => {
  it("parses LLM answers as a JSON array or a numbered list", () => {
    expect(parseScenes('Sure! ["a girl waits at a bus stop", "the bus arrives", "she boards"]', 3)).toEqual(["a girl waits at a bus stop", "the bus arrives", "she boards"]);
    expect(parseScenes("1. A girl waits at the stop\n2. Headlights wash over her\n3. She boards the bus", 2)).toEqual(["A girl waits at the stop", "Headlights wash over her"]);
    expect(parseScenes("no", 3)).toBeNull();
  });

  it("falls back to a shot list offline", () => {
    const s = heuristicScenes("a heist in Paris.", 3);
    expect(s).toHaveLength(3);
    expect(s[0]).toBe("establishing wide shot: a heist in Paris — beat 1 of 3");
  });

  it("tells chained frames which image is the previous one", () => {
    expect(framePrompt("the bus arrives", 1, { refs: 2, chainFrom: "last" })).toMatch(/Image 3 is the previous frame/);
    expect(framePrompt("the bus arrives", 1, { refs: 1, chainFrom: "first" })).toBe("Next Scene: the bus arrives.");
    expect(framePrompt("a girl waits", 0, { refs: 1, chainFrom: "last", style: "35mm film" })).toBe(
      "Frame 1 of a storyboard: a girl waits. Use the reference image for the characters and look. Style: 35mm film. Cinematic still, consistent production design.",
    );
  });

  it("uses edit-capable models for follow-up frames on both engines", () => {
    for (const m of Object.values(STORYBOARD_MODELS)) {
      expect(getModel(m.next)?.routes.some((r) => r.op === "edit")).toBe(true);
      expect(getModel(m.first)?.routes.some((r) => r.op === "t2i")).toBe(true);
    }
  });
});
