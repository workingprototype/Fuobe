import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getModel } from "@/lib/catalog";
import { aiToolkitJob, TRAINING_TARGETS, triggerFor } from "@/lib/catalog/training";
import { buildPayload } from "@/lib/catalog/payload";
import { zip } from "@/server/zip";

describe("identity training", () => {
  it("makes short, rare trigger words", () => {
    expect(triggerFor("Nova_Reyes")).toBe("nvrysfz");
    expect(triggerFor("Al")).toBe("alfz");
  });

  it("only targets models that exist, with the open target on the open engine", () => {
    for (const t of TRAINING_TARGETS) for (const id of t.modelIds) expect(getModel(id)?.engine, `${t.id} → ${id}`).toBe(t.engine);
  });

  it("writes AI-Toolkit jobs for Z-Image Turbo with the training adapter", () => {
    const job = aiToolkitJob({ name: "x", trigger: "nvrysfz", datasetFolder: "/d", outputFolder: "/o" });
    const p = job.config.process[0];
    expect(p.trigger_word).toBe("nvrysfz");
    expect(p.model.arch).toBe("zimage:turbo");
    expect(p.model.assistant_lora_path).toMatch(/training_adapter/);
    expect(p.datasets[0].folder_path).toBe("/d");
  });

  it("switches hosted Z-Image to its LoRA endpoint only when a LoRA URL is present", () => {
    const route = getModel("z-image-turbo-cloud")!.routes[0];
    expect(route.loraEndpoint).toBe("fal-ai/z-image/turbo/lora");
    expect(buildPayload(route.map!, { prompt: "x" }).loras).toBeUndefined();
  });

  it("writes zips other tools can read", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-zip-"));
    const file = path.join(dir, "kit.zip");
    fs.writeFileSync(file, zip([{ name: "dataset/01.txt", data: Buffer.from("photo of nvrysfz") }, { name: "a.yaml", data: Buffer.from("{}") }]));
    const out = execFileSync("python3", ["-I", "-c", "import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip(), z.read('dataset/01.txt').decode())", file]).toString();
    expect(out.trim()).toBe("None photo of nvrysfz");
  });
});
