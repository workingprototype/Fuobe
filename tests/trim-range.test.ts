import { describe, expect, it } from "vitest";
import { clampRange, clock, initialRange, moveRange, parseTime, setEdge, thumbTimes, trimHint, trimKey } from "@/lib/trim-range";

const L = { duration: 30, min: 4, max: 10 };

describe("video trimmer arithmetic", () => {
  it("starts with as much of the clip as allowed", () => {
    expect(initialRange(30, 10)).toEqual({ startTime: 0, endTime: 10 });
    expect(initialRange(7.25)).toEqual({ startTime: 0, endTime: 7.25 });
    expect(initialRange(3, 10)).toEqual({ startTime: 0, endTime: 3 });
  });

  it("moves one edge without moving the other, stopping at min and max length", () => {
    const r = { startTime: 5, endTime: 12 };
    expect(setEdge(r, "start", 1, L)).toEqual({ startTime: 2, endTime: 12 }); // max 10 s
    expect(setEdge(r, "start", 10, L)).toEqual({ startTime: 8, endTime: 12 }); // min 4 s
    expect(setEdge(r, "end", 40, L)).toEqual({ startTime: 5, endTime: 15 });
    expect(setEdge(r, "end", 6, L)).toEqual({ startTime: 5, endTime: 9 });
    expect(setEdge(r, "start", -3, { duration: 30 })).toEqual({ startTime: 0, endTime: 12 });
    expect(setEdge(r, "end", Number.NaN, L)).toBe(r);
  });

  it("slides the window inside the clip, keeping its length", () => {
    const r = { startTime: 5, endTime: 12 };
    expect(moveRange(r, 3, L)).toEqual({ startTime: 8, endTime: 15 });
    expect(moveRange(r, 100, L)).toEqual({ startTime: 23, endTime: 30 });
    expect(moveRange(r, -100, L)).toEqual({ startTime: 0, endTime: 7 });
    // A window longer than allowed is cut to the max when slid.
    expect(clampRange({ startTime: 0, endTime: 25 }, L, "move")).toEqual({ startTime: 0, endTime: 10 });
  });

  it("handles clips shorter than the minimum", () => {
    expect(clampRange({ startTime: 0, endTime: 3 }, { duration: 3, min: 4, max: 10 }, "end")).toEqual({ startTime: 0, endTime: 3 });
  });

  it("asks for the right selection", () => {
    expect(trimHint({ duration: 30, min: 1, max: 10 })).toBe("Select a 10-second segment");
    expect(trimHint({ duration: 30, max: 15 })).toBe("Select a 15-second segment");
    expect(trimHint({ duration: 200, min: 4, max: 120 })).toBe("Select up to 2 minutes");
    expect(trimHint({ duration: 2.5, min: 4, max: 120 })).toBe("This clip is 2.5 s — it needs at least 4 seconds");
    expect(trimHint({ duration: 8, min: 1, max: 10 })).toBe(null);
  });

  it("spreads filmstrip frames over the clip and prints times", () => {
    expect(thumbTimes(10, 4)).toEqual([1.25, 3.75, 6.25, 8.75]);
    expect(thumbTimes(0, 4)).toEqual([]);
    expect(clock(65.34)).toBe("1:05.3");
    expect(clock(4)).toBe("0:04.0");
  });
});

describe("video trimmer keyboard (the sliders' contract, shared by every studio that uses it)", () => {
  const r = { startTime: 5, endTime: 12 };
  it("moves the start, end and window by 0.1 s, ×10 with Shift, 5 s with Page Up / Down", () => {
    expect(trimKey(r, "start", "ArrowRight", false, L)).toEqual({ startTime: 5.1, endTime: 12 });
    expect(trimKey(r, "start", "ArrowLeft", true, L)).toEqual({ startTime: 4, endTime: 12 });
    expect(trimKey(r, "end", "ArrowUp", false, L)).toEqual({ startTime: 5, endTime: 12.1 });
    expect(trimKey(r, "end", "PageDown", false, L)).toEqual({ startTime: 5, endTime: 9 });
    expect(trimKey(r, "move", "PageUp", false, L)).toEqual({ startTime: 10, endTime: 17 });
    expect(trimKey(r, "move", "ArrowLeft", true, L)).toEqual({ startTime: 4, endTime: 11 });
  });
  it("Home / End go to the clip's ends within the min and max length", () => {
    // The start can't go further back than 10 s (max) before the end.
    expect(trimKey(r, "start", "Home", false, L)).toEqual({ startTime: 2, endTime: 12 });
    expect(trimKey(r, "end", "End", false, L)).toEqual({ startTime: 5, endTime: 15 });
    expect(trimKey(r, "move", "Home", false, L)).toEqual({ startTime: 0, endTime: 7 });
    expect(trimKey(r, "move", "End", false, L)).toEqual({ startTime: 23, endTime: 30 });
    // Never shorter than the min (4 s).
    expect(trimKey({ startTime: 5, endTime: 9 }, "end", "PageDown", false, L)).toEqual({ startTime: 5, endTime: 9 });
    expect(trimKey({ startTime: 5, endTime: 9 }, "start", "ArrowRight", true, L)).toEqual({ startTime: 5, endTime: 9 });
  });
  it("ignores other keys", () => {
    expect(trimKey(r, "start", "a", false, L)).toBeNull();
    expect(trimKey(r, "move", "Tab", false, L)).toBeNull();
  });
  it("reads typed times", () => {
    expect(parseTime("12.5")).toBe(12.5);
    expect(parseTime("0:12.5")).toBe(12.5);
    expect(parseTime("1:05")).toBe(65);
    expect(parseTime(" 7 s ")).toBe(7);
    expect(parseTime("abc")).toBeNaN();
    expect(setEdge(r, "end", parseTime("0:12.5"), L)).toEqual({ startTime: 5, endTime: 12.5 });
  });
});
