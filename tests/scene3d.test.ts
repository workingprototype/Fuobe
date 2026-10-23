import { describe, expect, it } from "vitest";
import {
  BOOST,
  blurScale,
  buildPointCloud,
  canvasFov,
  captureSize,
  dolly,
  flyStep,
  focalForFov,
  focusDistance,
  forwardOf,
  frameRect,
  frameSensor,
  keysToInput,
  lensFov,
  lookStep,
  medianDepth,
  depthEncoding,
  nearIsBright,
  objectStart,
  poseWords,
  ratioOf,
  readDepth,
  recomposePrompt,
  sceneFov,
  scenePose,
  spectralColor,
  spectralValue,
  strafe,
  twoFinger,
  type FlyPose,
  type Pixels,
} from "@/lib/scene3d";

const start: FlyPose = { position: [0, 0, 0], yaw: 0, pitch: 0 };
const close = (a: number[], b: number[], digits = 4) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

describe("lens → field of view", () => {
  it("puts every ratio's frame inside the full-frame sensor", () => {
    expect(frameSensor(16 / 9)).toEqual({ width: 36, height: 20.25 });
    expect(frameSensor(3 / 2)).toEqual({ width: 36, height: 24 });
    expect(frameSensor(1)).toEqual({ width: 24, height: 24 });
    expect(frameSensor(9 / 16).height).toBe(24);
    expect(frameSensor(9 / 16).width).toBeCloseTo(13.5);
  });

  it("gives the classic angles (24 mm ≈ 74° across, 50 mm ≈ 40°) and inverts", () => {
    const wide = lensFov(24, 16 / 9);
    expect(wide.h).toBeCloseTo(73.74, 1);
    expect(wide.v).toBeCloseTo(45.7, 1);
    expect(lensFov(50, 3 / 2).h).toBeCloseTo(39.6, 1);
    expect(lensFov(300, 16 / 9).h).toBeLessThan(7);
    for (const f of [18, 24, 35, 85, 300]) expect(focalForFov(lensFov(f, 21 / 9).h, 21 / 9)).toBeCloseTo(f, 6);
  });

  it("reads ratios and sizes the capture in multiples of 16", () => {
    expect(ratioOf("16:9")).toBeCloseTo(16 / 9);
    expect(ratioOf("2.39:1")).toBeCloseTo(2.39);
    expect(ratioOf("auto")).toBe(1);
    expect(captureSize(16 / 9)).toEqual({ width: 1536, height: 864 });
    expect(captureSize(9 / 16)).toEqual({ width: 864, height: 1536 });
    expect(captureSize(21 / 9, 1024)).toEqual({ width: 1024, height: 432 });
  });

  it("lays the frame into the viewport and widens the canvas camera to match", () => {
    expect(frameRect(1600, 900, 16 / 9)).toEqual({ x: 0, y: 0, width: 1600, height: 900 });
    const tall = frameRect(390, 800, 16 / 9, 15);
    expect(tall.width).toBe(360);
    expect(tall.x).toBe(15);
    expect(tall.height).toBeCloseTo(202.5);
    // The frame is a quarter of the canvas height: the canvas camera sees four times the tangent.
    const v = lensFov(24, 16 / 9).v;
    const fov = canvasFov(v, 200, 800);
    expect(Math.tan((fov * Math.PI) / 360)).toBeCloseTo(4 * Math.tan((v * Math.PI) / 360), 6);
    expect(canvasFov(v, 800, 800)).toBeCloseTo(v, 6);
  });
});

describe("flying", () => {
  it("maps W A S D Q E by key position", () => {
    expect(keysToInput(["KeyW"])).toEqual({ forward: 1, right: 0, up: 0 });
    expect(keysToInput(["KeyS", "KeyA", "KeyQ"])).toEqual({ forward: -1, right: -1, up: -1 });
    expect(keysToInput(["KeyW", "KeyS", "KeyE"])).toEqual({ forward: 0, right: 0, up: 1 });
  });

  it("flies down -Z at the start, sideways level, and no faster on a diagonal", () => {
    close(flyStep(start, { forward: 1, right: 0, up: 0 }, 0.05, 20).position, [0, 0, -1]);
    close(flyStep(start, { forward: 0, right: 1, up: 0 }, 0.05, 20).position, [1, 0, 0]);
    close(flyStep(start, { forward: 0, right: 0, up: -1 }, 0.05, 20).position, [0, -1, 0]);
    const diag = flyStep(start, { forward: 1, right: 1, up: 0 }, 0.05, 20).position;
    expect(Math.hypot(...diag)).toBeCloseTo(1);
    close(flyStep(start, { forward: 1, right: 0, up: 0 }, 0.05, 20, true).position, [0, 0, -BOOST]);
    // A long frame (a hidden tab) never jumps more than 0.1 s.
    close(flyStep(start, { forward: 1, right: 0, up: 0 }, 5, 1).position, [0, 0, -0.1]);
    expect(flyStep(start, { forward: 0, right: 0, up: 0 }, 1, 1)).toBe(start);
  });

  it("looks with the mouse: right turns right, up looks up, never over the top", () => {
    const turned = lookStep(start, 100, 0, 0.01);
    expect(turned.yaw).toBeCloseTo(-1);
    close(forwardOf(turned.yaw, 0), [Math.sin(1), 0, -Math.cos(1)]);
    expect(lookStep(start, 0, -100, 0.01).pitch).toBeCloseTo(1);
    expect(lookStep(start, 0, -10_000).pitch).toBeLessThan(Math.PI / 2);
    // Looking straight down, W flies down.
    const down = { ...start, pitch: -Math.PI / 2 + 0.01 };
    expect(flyStep(down, { forward: 1, right: 0, up: 0 }, 0.1, 10).position[1]).toBeLessThan(-0.99);
  });

  it("reads two fingers as a move and a pinch, and moves along and across the view", () => {
    const g = twoFinger([{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ x: 10, y: 20 }, { x: 210, y: 20 }]);
    expect(g).toEqual({ dx: 60, dy: 20, scale: 2 });
    close(dolly(start, 2).position, [0, 0, -2]);
    close(strafe({ ...start, yaw: Math.PI / 2 }, 1, 0.5).position, [0, 0.5, -1]);
  });
});

describe("where the camera starts", () => {
  it("reads the photo's field of view and subject distance from a camera-space scene", () => {
    const fov = sceneFov(new Float32Array([-1, -0.5, -2, 1, 0.5, -2, 0, 0, -4]))!;
    expect(fov.h).toBeCloseTo(53.13, 1);
    expect(fov.v).toBeCloseTo(28.07, 1);
    expect(medianDepth(new Float32Array([0, 0, -1, 0, 0, -3, 0, 0, -9]))).toBe(3);
  });

  it("frames an object around the origin from the front instead", () => {
    // The demo crystal has points behind the origin: it is an object, not a scene.
    expect(sceneFov(new Float32Array([0, 1, 0.5, 0, -1, -0.5, 0.6, 0, 0.6]))).toBeNull();
    const pose = objectStart([0, 0, 0], 1, 60);
    expect(pose.position[2]).toBeCloseTo(2.2);
    expect(pose.yaw).toBe(0);
  });
});

function pixels(width: number, height: number, fill: (x: number, y: number) => [number, number, number]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fill(x, y);
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
  return { width, height, data };
}

describe("point cloud from a photo and a depth map", () => {
  const photo = pixels(40, 20, (x) => [x * 6, 100, 200]);
  // Bright = near: the bottom rows are nearest (a floor), the top far (a wall).
  const depthMap = pixels(20, 10, (_x, y) => [Math.round((y / 9) * 255), 0, 0]);

  it("tells which way a map runs from its top and bottom", () => {
    expect(nearIsBright(depthMap)).toBe(true);
    const flipped = pixels(20, 10, (_x, y) => [255 - Math.round((y / 9) * 255), 0, 0]);
    expect(nearIsBright(flipped)).toBe(false);
  });

  it("puts each pixel on its ray, between near and far, nearest at the bottom", () => {
    const cloud = buildPointCloud(photo, depthMap, { hFov: 90, near: 1, far: 5, edge: 0 });
    expect(cloud.stride).toBe(1);
    expect(cloud.count).toBe(800);
    const z = (k: number) => -cloud.positions[k * 3 + 2];
    const at = (x: number, y: number) => y * 40 + x;
    expect(z(at(5, 19))).toBeCloseTo(1, 5);
    expect(z(at(5, 0))).toBeCloseTo(5, 5);
    // 90° across: the left edge pixel's ray leaves at ~45°, so x ≈ −z there.
    const k = at(0, 10);
    expect(cloud.positions[k * 3] / -cloud.positions[k * 3 + 2]).toBeCloseTo(-(20 - 0.5) / 20, 5);
    // Up is +Y: the top half has positive y.
    expect(cloud.positions[at(20, 2) * 3 + 1]).toBeGreaterThan(0);
    // Colours come from the photo, sizes grow with distance.
    expect(cloud.colors[at(10, 5) * 3]).toBeCloseTo(60 / 255);
    expect(cloud.sizes[at(5, 0)]).toBeGreaterThan(cloud.sizes[at(5, 19)] * 4);
  });

  it("reads a dark-near map as depth, the same way round", () => {
    const depth = pixels(20, 10, (_x, y) => [255 - Math.round((y / 9) * 255), 0, 0]);
    const cloud = buildPointCloud(photo, depth, { hFov: 60, near: 1, far: 5, edge: 0 });
    expect(-cloud.positions[(19 * 40 + 3) * 3 + 2]).toBeCloseTo(1, 4);
    expect(-cloud.positions[3 * 3 + 2]).toBeCloseTo(5, 4);
  });

  it("samples big photos under the point budget and snaps a soft edge's smear to its sides", () => {
    const big = pixels(1000, 500, () => [10, 20, 30]);
    const flat = pixels(100, 50, () => [128, 0, 0]);
    const cloud = buildPointCloud(big, flat, { hFov: 60, maxPoints: 10_000 });
    expect(cloud.stride).toBe(8);
    expect(cloud.count).toBeLessThanOrEqual(10_000);
    // A near square on a far wall with a hard edge: every sample stays where it is.
    const box = pixels(40, 20, (x, y) => (x >= 10 && x < 30 && y >= 5 && y < 15 ? [255, 0, 0] : [0, 0, 0]));
    const hard = buildPointCloud(photo, box, { hFov: 60, near: 1, far: 5, nearIsBright: true });
    const hardAll = buildPointCloud(photo, box, { hFov: 60, near: 1, far: 5, nearIsBright: true, edge: 0 });
    expect(Array.from(hard.positions)).toEqual(Array.from(hardAll.positions));
    // A soft edge (a 4-sample ramp from the subject down to the wall): nothing is dropped and nothing floats between.
    const ramp = pixels(40, 20, (x) => [x < 10 ? 255 : x >= 14 ? 0 : Math.round(255 * (1 - (x - 9) / 5)), 0, 0]);
    const soft = buildPointCloud(photo, ramp, { hFov: 60, near: 1, far: 5, nearIsBright: true });
    expect(soft.count).toBe(800);
    const depths = Array.from({ length: soft.count }, (_, k) => -soft.positions[k * 3 + 2]);
    expect(depths.every((d) => Math.abs(d - 1) < 1e-4 || Math.abs(d - 5) < 1e-4)).toBe(true);
    // Each ramp sample went to the side it is nearer to in 1/z: the first two to the subject, the last two to the wall.
    expect([10, 11, 12, 13].map((x) => Math.round(depths[5 * 40 + x]))).toEqual([1, 1, 5, 5]);
  });
});

describe("Marigold's colour-mapped depth (Spectral: red near, violet far)", () => {
  it("inverts the colour map", () => {
    expect(spectralColor(0)).toEqual([158, 1, 66]);
    expect(spectralColor(0.5)).toEqual([255, 255, 191]);
    expect(spectralColor(1)).toEqual([94, 79, 162]);
    for (const t of [0, 0.03, 0.25, 0.5, 0.61, 0.9, 1]) {
      const v = spectralValue(...spectralColor(t));
      expect(v.t).toBeCloseTo(t, 2);
      expect(v.off).toBeLessThan(1);
    }
    // Colours read off fal's example output (a dog on a bench): the dog, the bench, the grass, the sky.
    expect(spectralValue(168, 11, 69).t).toBeLessThan(0.05);
    expect(spectralValue(247, 139, 81).t).toBeCloseTo(0.25, 1);
    expect(spectralValue(231, 244, 152).t).toBeCloseTo(0.6, 1);
    expect(spectralValue(44, 139, 183).t).toBeGreaterThan(0.85);
  });

  // Near at the bottom (red), far at the top (violet), as Marigold paints a photo with a floor.
  const spectralMap = pixels(20, 10, (_x, y) => spectralColor(1 - y / 9));

  it("tells a Spectral map from a grey one", () => {
    expect(depthEncoding(spectralMap)).toBe("spectral");
    expect(depthEncoding(pixels(20, 10, (_x, y) => [y * 20, y * 20, y * 20]))).toBe("grey");
    // Colour that isn't on the Spectral curve is read by its grey.
    expect(depthEncoding(pixels(20, 10, (x) => (x % 2 ? [255, 0, 0] : [0, 0, 255])))).toBe("grey");
  });

  it("reads red as near, as depth (not disparity), whatever the grey guess would say", () => {
    const field = readDepth(spectralMap);
    expect(field).toMatchObject({ encoding: "spectral", disparity: false });
    expect(field.nearness[9 * 20]).toBeCloseTo(1, 2);
    expect(field.nearness[0]).toBeCloseTo(0, 2);
    // The red channel alone rises and falls along the map: read as grey, the bottom and the middle would clash.
    expect(spectralColor(0)[0]).toBeLessThan(spectralColor(0.4)[0]);
    expect(spectralColor(0.4)[0]).toBeGreaterThan(spectralColor(1)[0]);
    const photo = pixels(40, 20, () => [128, 128, 128]);
    const cloud = buildPointCloud(photo, spectralMap, { hFov: 60, near: 1, far: 5, edge: 0 });
    expect(cloud.encoding).toBe("spectral");
    const z = (x: number, y: number) => -cloud.positions[(y * 40 + x) * 3 + 2];
    expect(z(5, 19)).toBeCloseTo(1, 1);
    expect(z(5, 0)).toBeCloseTo(5, 1);
    // Linear in depth: halfway down the map is halfway between near and far.
    const mid = buildPointCloud(photo, pixels(20, 3, (_x, y) => spectralColor([1, 0.5, 0][y])), { hFov: 60, near: 1, far: 5, edge: 0 });
    expect(-mid.positions[(10 * 40 + 5) * 3 + 2]).toBeCloseTo(3, 0);
  });

  it("keeps reading grey maps either way round", () => {
    const grey = pixels(20, 10, (_x, y) => {
      const g = Math.round((y / 9) * 255);
      return [g, g, g];
    });
    expect(readDepth(grey)).toMatchObject({ encoding: "grey", disparity: true });
    expect(readDepth(grey, false)).toMatchObject({ encoding: "grey", disparity: false });
    expect(readDepth(grey).nearness[9 * 20]).toBeCloseTo(1, 5);
    expect(readDepth(grey, false).nearness[9 * 20]).toBeCloseTo(0, 5);
  });
});

describe("depth of field and focus", () => {
  it("blurs like a thin lens: more with a longer lens, a wider aperture and a closer focus", () => {
    const a = blurScale(50, 1.4, 2, 3 / 2);
    expect(a * (4 / 6)).toBeCloseTo(0.017, 3);
    expect(blurScale(85, 1.4, 2)).toBeGreaterThan(blurScale(24, 1.4, 2));
    expect(blurScale(50, 1.4, 2)).toBeGreaterThan(blurScale(50, 16, 2) * 10);
    expect(blurScale(50, 4, 1)).toBeGreaterThan(blurScale(50, 4, 5));
  });

  it("focuses on the nearest thing at the centre of the frame", () => {
    const pts = new Float32Array([0, 0, -2, 0.01, 0, -2.02, 0, 0, -6, 3, 0, -1]);
    expect(focusDistance(pts, start)).toBeCloseTo(2, 1);
    expect(focusDistance(pts, { ...start, yaw: Math.PI })).toBeNull();
  });
});

describe("the captured camera → a recomposition", () => {
  it("is the photo's own view (front, eye level, as framed) before moving", () => {
    expect(scenePose({ position: [0, 0, 0], yaw: 0, pitch: 0 }, 24, 24, 3)).toEqual({ horizontal: 0, vertical: 0, zoom: 5 });
    expect(poseWords({ horizontal: 0, vertical: 0, zoom: 5 })).toBe("front view eye-level shot medium shot");
  });

  it("orbits right and up, aimed at the subject, into a front-right elevated view", () => {
    // 3 m from the pivot, swung 45° right and raised 30°, looking back at it.
    const d = 3;
    const pos: [number, number, number] = [Math.sin(Math.PI / 4) * Math.cos(Math.PI / 6) * d, Math.sin(Math.PI / 6) * d, -3 + Math.cos(Math.PI / 4) * Math.cos(Math.PI / 6) * d];
    const p = scenePose({ position: pos, yaw: Math.PI / 4, pitch: -Math.PI / 6 }, 24, 24, 3);
    expect(p.horizontal).toBeCloseTo(45, 0);
    expect(p.vertical).toBeCloseTo(30, 0);
    expect(p.zoom).toBeCloseTo(5, 1);
    expect(poseWords(p)).toBe("front-right quarter view elevated shot medium shot");
    // Swung round to the left: 315°.
    expect(scenePose({ position: [-3, 0, -3], yaw: -Math.PI / 2, pitch: 0 }, 24, 24, 3).horizontal).toBeCloseTo(270, 0);
  });

  it("stays a back view right behind the subject, whichever side of 180° the camera looks", () => {
    // 3 m behind the pivot, looking back at it: the orbit angle is ~179° and the yaw goes past ±180°.
    for (const deg of [178, 180, 182]) {
      const p = scenePose({ position: [0.05, 0, -6], yaw: (deg * Math.PI) / 180, pitch: 0 }, 24, 24, 3);
      expect(p.horizontal).toBeGreaterThanOrEqual(178);
      expect(p.horizontal).toBeLessThanOrEqual(181);
      expect(poseWords(p)).toBe("back view eye-level shot medium shot");
    }
    // Either side of the front, the mean wraps through 0° and stays the front, not 180° away.
    for (const [x, deg] of [
      [0.05, -2],
      [-0.05, 2],
      [0.05, 2],
    ]) {
      const p = scenePose({ position: [x, 0, 0], yaw: (deg * Math.PI) / 180, pitch: 0 }, 24, 24, 3);
      expect(Math.min(p.horizontal, 360 - p.horizontal)).toBeLessThanOrEqual(2);
      expect(poseWords(p)).toBe("front view eye-level shot medium shot");
    }
  });

  it("zooms with the lens and the distance, within 0–10", () => {
    expect(scenePose(start, 48, 24, 3).zoom).toBeCloseTo(10);
    expect(scenePose({ ...start, position: [0, 0, -1.5] }, 24, 24, 3).zoom).toBeCloseTo(10);
    expect(scenePose({ ...start, position: [0, 0, 3] }, 24, 24, 3).zoom).toBeCloseTo(0);
    expect(scenePose(start, 300, 24, 3).zoom).toBe(10);
    expect(poseWords({ horizontal: 200, vertical: -25, zoom: 1 })).toBe("back view low-angle shot wide shot");
  });

  it("sends clean numbers: whole degrees and one decimal of zoom, with no float noise", () => {
    for (let z = -2.5; z <= 2.5; z += 0.13) {
      const p = scenePose({ position: [0.37 * z, 0.21, z], yaw: 0.3, pitch: -0.1 }, 35, 24, 3);
      expect(String(p.zoom)).toMatch(/^\d+(\.\d)?$/);
      expect(String(p.vertical)).toMatch(/^-?\d+(\.\d)?$/);
      expect(Number.isInteger(p.horizontal)).toBe(true);
    }
  });

  it("asks to re-render the exact view with the photo's look, the lens and the user's note", () => {
    const p = recomposePrompt(85, 1.4, "make it dusk.");
    expect(p).toMatch(/^Re-render this exact camera view of the scene photorealistically\./);
    expect(p).toContain("Image 1 is a rough 3D render");
    expect(p).toContain("Image 2 is the original photo");
    expect(p).toMatch(/holes, gaps and stretched textures/);
    expect(p).toContain("Shot on a 85 mm portrait telephoto lens at f/1.4, very shallow depth of field");
    expect(p.endsWith("make it dusk.")).toBe(true);
    expect(recomposePrompt(24, 11)).toContain("f/11, deep focus");
  });
});
