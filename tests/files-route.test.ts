import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-files-route-"));
process.env.FUOBE_DATA_DIR = dir;
const { GET } = await import("@/app/api/files/[...path]/route");
afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

const get = (parts: string[]) => GET(new Request(`http://localhost:3000/api/files/${parts.join("/")}`), { params: Promise.resolve({ path: parts }) } as never);

describe("/api/files decodes a path once", () => {
  it("never turns %2e into a step out of the folder", async () => {
    // A secret beside the files folder, and a file inside it.
    fs.mkdirSync(path.join(dir, "files", "uploads"), { recursive: true });
    fs.writeFileSync(path.join(dir, "secret.txt"), "secret");
    fs.writeFileSync(path.join(dir, "files", "uploads", "a.txt"), "hello");
    // Next hands the route each segment decoded once: "%252e%252e" arrives as "%2e%2e", which must stay a name.
    const r = await get(["uploads", "%2e%2e", "%2e%2e", "secret.txt"]);
    expect(r.status).toBe(404);
    expect(await r.text()).not.toContain("secret");
    expect((await get(["..", "secret.txt"])).status).toBe(400);
    const ok = await get(["uploads", "a.txt"]);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("hello");
  });
});
