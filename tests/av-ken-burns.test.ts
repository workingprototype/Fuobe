import { describe, expect, it } from "vitest";
import { describeMove, focusFromText, kenBurnsMove, readMove, sceneMoves, splitMove, zoomAmount, type KenBurnsMove } from "@/lib/av/ken-burns";

/** The crop centre must keep the crop inside the still at that zoom. */
const fits = (m: KenBurnsMove) =>
  [
    [m.zoomFrom, m.panFrom],
    [m.zoomTo, m.panTo],
  ].every(([z, p]) => {
    const r = 0.5 - 0.5 / (z as number);
    const { x, y } = p as { x: number; y: number };
    return x >= 0.5 - r - 1e-9 && x <= 0.5 + r + 1e-9 && y >= 0.5 - r - 1e-9 && y <= 0.5 + r + 1e-9;
  });

describe("Ken Burns moves", () => {
  it("reads the move from the scene's camera words, not from what moves in it", () => {
    expect(readMove("slow camera push-in, subtle movement in the scene")).toBe("push-in");
    expect(readMove("The camera slowly zooms out to reveal the whole valley")).toBe("pull-out");
    expect(readMove("pan left across the battlefield as smoke drifts")).toBe("pan-left");
    expect(readMove("slow pan from left to right")).toBe("pan-right");
    expect(readMove("tilt up to the stars")).toBe("tilt-up");
    expect(readMove("smoke rising from the chimney")).toBeNull();
    expect(readMove("camera pans across the market")).toBe("pan-right");
    expect(readMove("leaves flutter in the wind")).toBeNull();
    // The common ways of asking for a zoom (the timeline's Motion change).
    for (const t of ["zoom into the lighthouse", "zoom-in on the map", "slow zoom toward the castle", "zoom on the face", "a slow zoom", "zoomed in", "push-in"]) expect(readMove(t), t).toBe("push-in");
    for (const t of ["zoom-out", "zooming back to the whole street", "slowly zoom out to reveal the bay", "pulled back"]) expect(readMove(t), t).toBe("pull-out");
    expect(readMove("the flags wave in the wind")).toBeNull();
    expect(readMove("the boat moves closer to the shore")).toBeNull();
  });

  it("finds the place the words name, and not a past tense of leave", () => {
    expect(focusFromText("a lighthouse on the far left, the sea beyond")).toEqual({ x: 0.33, y: 0.45 });
    expect(focusFromText("towards the tower in the upper right corner")).toEqual({ x: 0.67, y: 0.34 });
    expect(focusFromText("footprints in the foreground")).toEqual({ x: 0.5, y: 0.64 });
    expect(focusFromText("the army left the burning city")).toBeNull();
    expect(focusFromText("a quiet street at dawn")).toBeNull();
  });

  it("zooms slowly from the whole picture toward the focal point, and pans as far as the crop can go", () => {
    expect(zoomAmount(10)).toBe(0.25);
    expect(zoomAmount(4)).toBe(0.1);
    expect(zoomAmount(2)).toBe(0.08);
    const push = kenBurnsMove("push-in", { x: 0.2, y: 0.3 }, 8);
    expect(push).toMatchObject({ zoomFrom: 1, zoomTo: 1.2, panFrom: { x: 0.5, y: 0.5 }, easing: "ease-in-out" });
    expect(push.panTo).toEqual({ x: 0.417, y: 0.417 }); // as far toward it as the crop stays inside
    expect(fits(push)).toBe(true);
    const out = kenBurnsMove("pull-out", { x: 0.55, y: 0.45 }, 8);
    expect(out).toMatchObject({ zoomFrom: 1.2, zoomTo: 1, panFrom: { x: 0.55, y: 0.45 }, panTo: { x: 0.5, y: 0.5 } });
    const pan = kenBurnsMove("pan-left", { x: 0.5, y: 0.45 }, 10);
    expect(pan).toMatchObject({ zoomFrom: 1.25, zoomTo: 1.25, panFrom: { x: 0.6, y: 0.45 }, panTo: { x: 0.4, y: 0.45 } });
    const short = kenBurnsMove("tilt-up", { x: 0.5, y: 0.5 }, 3);
    expect(short.zoomFrom).toBe(1.12); // a pan always keeps room to move
    expect(short.panFrom.y).toBeGreaterThan(short.panTo.y);
    for (const m of [push, out, pan, short]) expect(fits(m)).toBe(true);
    expect(describeMove(push)).toBe("Slow push-in toward the upper left");
    expect(describeMove(pan)).toBe("Slow pan left");
  });

  it("turns pans into a zoom toward their side when only zooms are possible (cloud)", () => {
    const m = kenBurnsMove("pan-right", { x: 0.5, y: 0.42 }, 6, { zoomOnly: true });
    expect(m).toMatchObject({ kind: "pan-right", zoomFrom: 1, zoomTo: 1.15, panFrom: { x: 0.5, y: 0.5 } });
    expect(m.panTo.x).toBeGreaterThan(0.5);
    expect(m.panTo.y).toBe(0.435);
  });

  it("splits a long scene into pieces that continue one move at one speed, cut between frames", () => {
    const whole = kenBurnsMove("pan-right", { x: 0.5, y: 0.45 }, 14);
    const [a, b] = splitMove(whole, [7, 7], 24);
    expect(a).toMatchObject({ zoomFrom: whole.zoomFrom, panFrom: whole.panFrom, easing: "linear" });
    expect(b).toMatchObject({ zoomTo: whole.zoomTo, panTo: whole.panTo, easing: "linear" });
    // 336 frames in all: piece 1 shows frames 0–167 of the move, piece 2 frames 168–335, so the step from
    // piece 1's last frame to piece 2's first is one frame's worth, like every other step (no frame repeats).
    const step = (whole.panTo.x - whole.panFrom.x) / 335;
    expect(a.panTo.x).toBeCloseTo(whole.panFrom.x + step * 167, 3);
    expect(b.panFrom.x - a.panTo.x).toBeCloseTo(step, 3);
    expect((a.panTo.x - a.panFrom.x) / 167).toBeCloseTo(step, 4);
    // Unequal pieces: 6 + 3 s → the seam two thirds of the way.
    const push = kenBurnsMove("push-in", { x: 0.3, y: 0.4 }, 9);
    const [c] = splitMove(push, [6, 3], 24);
    expect(c.zoomTo).toBeCloseTo(1 + ((push.zoomTo - 1) * 143) / 215, 3);
    expect(splitMove(whole, [9])).toEqual([whole]);
  });

  it("plans each scene: its own words, else the cycle; in and out in turn on the cloud", () => {
    const base = { visual: "A harbour at dusk", pieces: [6], ignore: "slow camera push-in, subtle movement in the scene" };
    const open = [0, 1, 2, 3].map((index) => sceneMoves({ ...base, motion: base.ignore, index })[0].kind);
    expect(open).toEqual(["push-in", "pan-right", "pull-out", "tilt-up"]);
    const cloud = [0, 1, 2, 3].map((index) => sceneMoves({ ...base, motion: base.ignore, index, zoomOnly: true })[0]);
    expect(cloud.map((m) => (m.zoomTo > m.zoomFrom ? "in" : "out"))).toEqual(["in", "out", "in", "out"]);
    const said = sceneMoves({ ...base, motion: "zoom out from the lighthouse on the left", index: 0 })[0];
    expect(said).toMatchObject({ kind: "pull-out", panFrom: { x: 0.435, y: 0.45 } }); // 1.15× leaves 6.5 % of room
    // A scene the open engine makes in two jobs.
    const split = sceneMoves({ ...base, motion: "pan left across the bay", index: 5, pieces: [7, 6] });
    expect(split.map((m) => m.easing)).toEqual(["linear", "linear"]);
    expect(split[1].panFrom.x).toBeLessThan(split[0].panTo.x); // a pan left goes on from where the first piece ended
    // The cloud's pieces go in, then back out from the same point.
    const back = sceneMoves({ ...base, motion: base.ignore, index: 0, pieces: [20, 20], zoomOnly: true });
    expect(back[1]).toMatchObject({ zoomFrom: back[0].zoomTo, zoomTo: back[0].zoomFrom, panFrom: back[0].panTo });
  });
});
