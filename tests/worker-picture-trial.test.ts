import { describe, expect, it } from "vitest";
import { canCleanPictures, trialPicture } from "../bin/lib/worker/picture.mjs";

describe("worker picture trial", () => {
  it("makes the test picture again with the installed library", () => {
    expect(trialPicture()).toBe(true);
    expect(canCleanPictures()).toBe(true);
  });

  it("can't clean pictures when the library is found but can't make one", () => {
    expect(canCleanPictures(() => "sharp", () => false)).toBe(false);
  });

  it("can't clean pictures when the library isn't installed, without a trial", () => {
    let tried = false;
    const missing = () => {
      throw new Error("not found");
    };
    expect(
      canCleanPictures(missing, () => {
        tried = true;
        return true;
      }),
    ).toBe(false);
    expect(tried).toBe(false);
  });

  it("fails the trial when the picture process fails or can't start", () => {
    expect(trialPicture({ spawnSyncFn: (() => ({ status: 1 })) as never })).toBe(false);
    expect(
      trialPicture({
        spawnSyncFn: () => {
          throw new Error("spawn failed");
        },
      }),
    ).toBe(false);
  });
});
