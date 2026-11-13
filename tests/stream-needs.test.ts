import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildIndex, loadInputs } from "../scripts/comfy/build-requirements.mjs";
import { parseIndex } from "@/lib/gpu/requirements";
import type { RequirementIndex } from "@/lib/gpu/types";

/**
 * Streaming needs (workflows/comfyui/stream-needs.json): a workflow a card can't hold whole still runs on it with part of
 * its weights kept in system RAM and streamed to the card each step (ComfyUI's dynamic VRAM loading). The requirements
 * build checks the file and writes each workflow's need into requirements.json.
 */

vi.setConfig({ testTimeout: 60_000 });

const ROOT = path.resolve(__dirname, "..");
const LIBRARY = path.join(ROOT, "workflows/comfyui");
const idx: RequirementIndex = parseIndex(JSON.parse(fs.readFileSync(path.join(LIBRARY, "requirements.json"), "utf8")));

const H3 = "minimax-h3-image-t2i";
const STREAMED = [
  "minimax-h3-image-t2i",
  "minimax-h3-image-edit",
  "minimax-h3-fast-t2v",
  "minimax-h3-fast-i2v",
  "minimax-h3-fast-flf2v",
  "minimax-h3-flash-t2v",
  "minimax-h3-flash-i2v",
  "minimax-h3-flash-flf2v",
  "krea2-turbo-t2i",
  "flux3-klein-t2i",
];

/** The committed inputs with stream-needs.json replaced. */
const build = (streams: object[]) => buildIndex({ ...loadInputs(LIBRARY), streams: { streams } });
const entry = (o: Record<string, unknown> = {}) => ({ workflows: [H3], vramGb: 10, ramGb: 32, ...o });

describe("the catalog's streaming needs (build-requirements.mjs)", () => {
  it("puts each workflow's streaming need in requirements.json", () => {
    for (const id of STREAMED) expect(idx.workflows[id].stream, id).toEqual({ vramGb: 10, ramGb: 32 });
    // A workflow with none keeps no field.
    expect("stream" in idx.workflows["z-image-turbo-t2i"]).toBe(false);
  });

  it("refuses numbers that aren't above 0, VRAM that isn't below the workflow's, and unknown or repeated workflows", () => {
    expect(() => build([entry({ vramGb: 0 })])).toThrow(/vramGb must be a number of GB above 0/);
    expect(() => build([entry({ ramGb: -1 })])).toThrow(/ramGb must be a number of GB above 0/);
    expect(() => build([entry({ ramGb: "32" })])).toThrow(/ramGb must be a number of GB above 0/);
    expect(() => build([entry({ vramGb: 32 })])).toThrow(`${H3} needs 32 GB of VRAM, so its streaming need must be below that (not 32 GB)`);
    expect(() => build([entry({ workflows: ["no-such-workflow"] })])).toThrow("no-such-workflow isn't a workflow of the manifest");
    expect(() => build([entry({ workflows: [] })])).toThrow(/workflows must name at least one workflow/);
    expect(() => build([entry(), entry({ ramGb: 64 })])).toThrow(`${H3} has a streaming need already`);
    expect(() => build([entry({ note: "x" })])).toThrow(/unknown field note/);
    expect(() => buildIndex({ ...loadInputs(LIBRARY), streams: {} as { streams: object[] } })).toThrow(/"streams" must be a list/);
    // A good one builds.
    expect(build([entry({ vramGb: 12, ramGb: 48 })]).workflows[H3].stream).toEqual({ vramGb: 12, ramGb: 48 });
  });
});
