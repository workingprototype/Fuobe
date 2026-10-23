import { afterEach, describe, expect, it, vi } from "vitest";
import { isApplePlatform, modKey } from "@/lib/keys";

describe("modifier key name", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("says ⌘ on Apple devices and Ctrl elsewhere", () => {
    for (const p of ["MacIntel", "iPhone", "iPad", "iPod touch"]) expect(isApplePlatform(p)).toBe(true);
    for (const p of ["Win32", "Linux x86_64", "Linux armv8l", ""]) expect(isApplePlatform(p)).toBe(false);
  });

  it("reads the browser's platform, and says Ctrl where there is none (the server)", () => {
    vi.stubGlobal("navigator", undefined);
    expect(modKey()).toBe("Ctrl");
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    expect(modKey()).toBe("⌘");
    vi.stubGlobal("navigator", { platform: "Win32" });
    expect(modKey()).toBe("Ctrl");
  });
});
