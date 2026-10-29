import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Links into Settings (/settings#id) land on a section or field that exists. */

const root = path.join(__dirname, "../src");
const files = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []));
const form = fs.readFileSync(path.join(root, "components/settings-form.tsx"), "utf8");
/** The anchors Settings has: its sections' and fields' ids (id="…", or a Section's id prop on its own line). */
const anchors = new Set([...form.matchAll(/\bid="([a-z0-9-]+)"/g)].map((m) => m[1]));

describe("Settings deep links", () => {
  it("every /settings#… link in the app has its anchor", () => {
    const links = files(root).flatMap((f) => [...fs.readFileSync(f, "utf8").matchAll(/\/settings#([a-z0-9-]+)/g)].map((m) => ({ file: path.relative(root, f), id: m[1] })));
    expect(links.length).toBeGreaterThan(5);
    for (const l of links) expect(anchors.has(l.id), `${l.file} links to /settings#${l.id}`).toBe(true);
  });

  it("the AI-Toolkit URL the training messages ask for has its field, with Save & test", () => {
    const section = form.slice(form.indexOf('id="training"'), form.indexOf("</Section>", form.indexOf('id="training"')));
    expect(section).toMatch(/name="aiToolkitUrl"[\s\S]*provider="ai-toolkit"/);
    expect(section).toMatch(/name="aiToolkitToken"/);
    const training = fs.readFileSync(path.join(root, "server/training.ts"), "utf8");
    expect(training).toContain("Settings → Training");
  });
});
