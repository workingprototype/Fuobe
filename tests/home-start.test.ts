import { describe, expect, it } from "vitest";
import { blockerFor, firstMissingSlot, handoffKey, startStep, withoutStart } from "@/lib/composer";
import { startQuotes } from "@/lib/starter-prices";
import { EDIT_STUDIO, IMAGE_STUDIO } from "@/lib/studios";

/** Home's Start runs the prompt in the studio it opens (R4-16). */

describe("the start flag", () => {
  it("is taken out of the address once used, keeping the hand-off", () => {
    expect(withoutStart("/image?prompt=a%20fox&go=1")).toBe("/image?prompt=a+fox");
    expect(withoutStart("http://localhost:3000/edit?go=1&prompt=sky#x")).toBe("http://localhost:3000/edit?prompt=sky#x");
    expect(withoutStart("/video?go=1")).toBe("/video");
    // It isn't part of the hand-off, so dropping it never rebuilds the draft.
    expect(handoffKey("prompt=a+fox&go=1")).toBe(handoffKey("prompt=a+fox"));
  });

  it("waits while things load, runs when nothing blocks, else explains what's missing", () => {
    expect(startStep({ settling: true, blocker: { message: "Loading models…" } })).toBe("wait");
    expect(startStep({ settling: false, blocker: null })).toBe("run");
    // Edit with a prompt and no photo: the blocker names the slot, which the toast points at.
    const missing = firstMissingSlot(EDIT_STUDIO.slots, {});
    const blocker = blockerFor({ model: true, missing, uploading: false, promptMissing: false });
    expect(blocker).toEqual({ message: "Add an image", slot: "image" });
    expect(startStep({ settling: false, blocker })).toBe("explain");
    // Image needs nothing but the prompt.
    expect(firstMissingSlot(IMAGE_STUDIO.slots, {})).toBeUndefined();
  });

  it("says what Start runs and costs in each mode", () => {
    const q = startQuotes();
    expect(q.image).toEqual({ cloud: { name: "Nano Banana Pro", price: expect.stringMatching(/^about \$[\d.]+ an image$/) }, open: { name: expect.any(String) } });
    expect(q.video.cloud?.price).toMatch(/^about \$[\d.]+ a 5 s clip$/);
    expect(q.edit.cloud?.price).toMatch(/an edit$/);
  });
});
