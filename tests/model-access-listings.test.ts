import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { indexEntries } from "@/lib/command-search";
import { paletteIndex } from "@/lib/palette-index";

/**
 * Settings → Models & licences in the places that list or pick models: GET /api/models (the CLI's list and the
 * studios' defaults), /api/status (what the browser filters its pickers with), Assist's and MCP's search_models,
 * the ⌘K palette, Assist's own picks, and POST /api/generations (the API refuses a model that is off).
 */

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-access-listings-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";
const { GET: listModels } = await import("@/app/api/models/route");
const { GET: status } = await import("@/app/api/status/route");
const { POST: postGeneration } = await import("@/app/api/generations/route");
const { changeAccess } = await import("@/server/model-access");
const tools = await import("@/server/assist/tools");
const { offlinePlan } = await import("@/server/assist/agent");
const { setSetting } = await import("@/server/settings");
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

type Body = { defaults: Record<string, { cloud?: string; open?: string }>; items: { id: string; engines: string[] }[] };
const models = async (query = "") => (await (await listModels(new Request(`http://localhost/api/models${query}`))).json()) as Body;

beforeEach(() => {
  changeAccess([{ kind: "reset" }]);
  setSetting("engineMode", "both");
  setSetting("demoMode", "on");
});

describe("Models & licences in listings and picks", () => {
  it("lists only what is on, and a studio default that is off gives way to the next model that is on", async () => {
    const before = await models("?kind=image");
    expect(before.items.map((m) => m.id)).toContain("nano-banana-pro");
    expect(before.defaults.image.cloud).toBe("nano-banana-pro");
    changeAccess([{ kind: "model", id: "nano-banana-pro", on: false }]);
    const after = await models("?kind=image");
    expect(after.items.map((m) => m.id)).not.toContain("nano-banana-pro");
    expect(after.defaults.image.cloud).toBeTruthy();
    expect(after.defaults.image.cloud).not.toBe("nano-banana-pro");
    // A whole licence class: the paid APIs. Fuobe Soul stays, on your GPU.
    changeAccess([{ kind: "class", id: "paid-api", on: false }]);
    const open = await models("?kind=image");
    expect(open.items.every((m) => m.engines.every((e) => e === "open"))).toBe(true);
    expect(open.items.find((m) => m.id === "fuobe-soul")?.engines).toEqual(["open"]);
  });

  it("tells the browser what is off through /api/status, and nothing while everything is on", async () => {
    expect(((await (await status()).json()) as { access?: unknown }).access).toBeUndefined();
    changeAccess([{ kind: "provider", id: "higgsfield", on: false }, { kind: "class", id: "research", on: false }]);
    const body = (await (await status()).json()) as { access: { off: string[] } };
    expect(body.access.off).toContain("oss-reactor");
    expect(body.access.off.length).toBeGreaterThan(5);
  });

  it("leaves switched-off models out of Assist's and MCP's search_models", async () => {
    const ids = async () => (JSON.parse((await tools.executeTool("search_models", { kind: "image" }, { engine: "cloud" })).content as string).models as { id: string }[]).map((m) => m.id);
    expect(await ids()).toContain("nano-banana-pro");
    changeAccess([{ kind: "model", id: "nano-banana-pro", on: false }]);
    expect(await ids()).not.toContain("nano-banana-pro");
  });

  it("picks Assist's model past one that is off", () => {
    const plan = () => (offlinePlan("a photo of a red bicycle", "cloud")!.input.jobs as { model_id: string }[])[0].model_id;
    expect(plan()).toBe("nano-banana-pro");
    changeAccess([{ kind: "model", id: "nano-banana-pro", on: false }]);
    expect(plan()).not.toBe("nano-banana-pro");
  });

  it("leaves switched-off models out of the ⌘K palette", () => {
    const index = paletteIndex();
    const has = (access?: { off: string[] }) => indexEntries(index, "both", access).some((e) => e.key === "model:nano-banana-pro");
    expect(has()).toBe(true);
    expect(has({ off: ["nano-banana-pro"] })).toBe(false);
  });

  it("refuses a model that is off through the API, naming the switch", async () => {
    changeAccess([{ kind: "class", id: "non-commercial", on: false }]);
    const res = await postGeneration(new Request("http://localhost/api/generations?preview=1", { method: "POST", body: JSON.stringify({ feature: "image", modelId: "oss-flux1-dev", prompt: "a cat" }) }));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toMatch(/^FLUX\.1 \[dev\] is turned off in Settings → Models & licences \(Non-commercial is switched off\)/);
  });
});
