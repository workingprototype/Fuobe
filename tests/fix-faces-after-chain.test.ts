import { describe, expect, it } from "vitest";
import { tempDir } from "./helpers/temp-dir";

process.env.FUOBE_DATA_DIR = tempDir("fuobe-fix-faces-chain-");

const { db } = await import("@/server/db");
const { finalClips } = await import("@/server/generations");

const add = (id: string, kind: "image" | "video", dependsOn: string | null) => {
  const now = Date.now();
  db()
    .prepare(
      "INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at, depends_on) VALUES (?, 'studio', 'm', 'open', 'comfyui', 'x', ?, 'queued', '{}', '[]', ?, ?, ?)",
    )
    .run(id, kind, now, now, dependsOn);
  return { id, kind } as never;
};

describe("Fix faces after a clip goes only on the finished clips", () => {
  it("leaves out a picture made first for the clip's end frame", () => {
    const still = add("still-1", "image", null);
    const clip = add("clip-1", "video", "still-1");
    expect(finalClips([still, clip]).map((g: { id: string }) => g.id)).toEqual(["clip-1"]);
  });

  it("leaves out clip parts another step joins, and keeps each take of a plain run", () => {
    const a = add("part-a", "video", null);
    const b = add("part-b", "video", null);
    const joined = add("joined", "video", JSON.stringify(["part-a", "part-b"]));
    expect(finalClips([a, b, joined]).map((g: { id: string }) => g.id)).toEqual(["joined"]);
    const t1 = add("take-1", "video", null);
    const t2 = add("take-2", "video", null);
    expect(finalClips([t1, t2]).map((g: { id: string }) => g.id)).toEqual(["take-1", "take-2"]);
  });
});
