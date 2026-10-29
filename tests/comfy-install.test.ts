import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Manifest } from "@/lib/comfy";
import { installScript } from "@/lib/comfy-install";

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../workflows/comfyui/manifest.json"), "utf8")) as Manifest;
const workflow = (id: string) => manifest.workflows.find((w) => w.id === id)!;
/** The install script read on an install with nothing yet (every model missing). */
const script = (id: string) => installScript({ ...workflow(id), models: workflow(id).models.map((m) => ({ ...m, present: false })) });
const H3_TOOL = "0670e4fdf95adf2262caa4b81afed2a9c4ae4b7b";
const H3_RELAY = "e2a7665b6eb8ea37a88c0de2c9c6b69a8f7c9220";

describe("Workflows → Copy install commands", () => {
  it("never hands git a GitHub page address (…/tree/<commit>/…): git can't clone those", () => {
    for (const wf of manifest.workflows) {
      const lines = script(wf.id).split("\n");
      for (const l of lines.filter((x) => /\bgit\b.*\bclone\b/.test(x))) expect(l, `${wf.id}: ${l}`).not.toMatch(/\/tree\//);
    }
  });

  it("H3 Relay: clones the repo, then checks out the pinned commit", () => {
    const s = script("video-character-swap-h3-relay");
    expect(s).toContain(`git clone https://github.com/akatz-ai/h3-relay "$COMFYUI/custom_nodes/h3-relay" && git -C "$COMFYUI/custom_nodes/h3-relay" checkout -q ${H3_RELAY}`);
  });

  it("h3_character_swap: the pack's folder copied out of the tool at the pinned commit (sparse), as install-comfyui.sh does", () => {
    const s = script("video-character-swap-h3");
    expect(s).toContain("git clone -q --filter=blob:none --no-checkout https://github.com/akatz-labs/h3-character-swap-tool");
    expect(s).toContain("sparse-checkout set --no-cone /worker_nodes/h3_character_swap/");
    expect(s).toContain(`checkout -q ${H3_TOOL}`);
    expect(s).toContain('cp -r "$tmp/worker_nodes/h3_character_swap" "$COMFYUI/custom_nodes/h3_character_swap"');
    // The same pin and folder as the install script.
    const sh = fs.readFileSync(path.join(__dirname, "../scripts/comfy/install-comfyui.sh"), "utf8");
    expect(sh).toContain(`H3_TOOL_REF="\${H3_TOOL_REF:-${H3_TOOL}}"`);
    expect(sh).toContain(`H3_RELAY_REF="\${H3_RELAY_REF:-${H3_RELAY}}"`);
    expect(sh).toContain("sparse-checkout set --no-cone /worker_nodes/h3_character_swap/");
  });

  it("a plain repo address is cloned as before, and models still follow the packs", () => {
    const wf = manifest.workflows.find((w) => w.customNodes.some((n) => !n.repo.includes("/tree/")) && w.models.some((m) => m.url && !m.optional))!;
    const s = script(wf.id).split("\n");
    expect(s[0]).toBe("COMFYUI=${COMFYUI:-$HOME/ComfyUI}");
    const plain = wf.customNodes.find((n) => !n.repo.includes("/tree/"))!;
    expect(s).toContain(`git -C "$COMFYUI/custom_nodes" clone ${plain.repo}`);
    expect(s.findIndex((l) => l.startsWith("mkdir -p"))).toBeGreaterThan(s.findIndex((l) => l.includes(plain.repo)));
  });
});
