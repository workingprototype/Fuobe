import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60_000 });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-assist-sugg-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const agent = await import("@/server/assist/agent");
const tools = await import("@/server/assist/tools");
const { db } = await import("@/server/db");
const { ASSIST_SUGGESTIONS } = await import("@/lib/assist");

beforeAll(() => setSetting("demoMode", "auto"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

type Job = Record<string, unknown>;
const jobsOf = (p: ReturnType<typeof agent.offlinePlan>) => ((p?.input as { jobs?: Job[] }).jobs ?? []) as Job[];

describe("Assist's suggestion chips on the offline planner (R4-04)", () => {
  it.each(["cloud", "open"] as const)("plans every chip into jobs that price without errors (%s)", (engine) => {
    for (const s of ASSIST_SUGGESTIONS) {
      const p = agent.offlinePlan(s, engine);
      expect(p, s).not.toBeNull();
      expect(["generate", "create_storyboard"], s).toContain(p!.tool);
      const plan = tools.planFor(p!.tool, p!.input, { engine });
      expect(plan.error, s).toBeUndefined();
      expect(plan.jobs.length, s).toBeGreaterThan(0);
      expect(plan.jobs.filter((j) => j.error).map((j) => j.error), s).toEqual([]);
    }
  });

  it("hero still, then animate it: a still, then a 3-shot clip made from it", () => {
    const p = agent.offlinePlan(ASSIST_SUGGESTIONS[0], "cloud")!;
    const plan = tools.planFor(p.tool, p.input, { engine: "cloud" });
    expect(plan.jobs.map((j) => [j.kind, j.op])).toEqual([
      ["image", "t2i"],
      ["video", "i2v"],
    ]);
    expect(jobsOf(p)[1]).toMatchObject({ after: 0, shots: 3 });
  });

  it("four portraits, then pick the best: four takes of one portrait, and a question instead of animating the first", () => {
    const p = agent.offlinePlan(ASSIST_SUGGESTIONS[1], "cloud")!;
    const jobs = jobsOf(p);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ model_id: "nano-banana-pro", outputs: 4, prompt: "Moody portrait of a lighthouse keeper, 35mm film" });
    expect(jobs[0].after).toBeUndefined();
    expect((p.input as { summary: string }).summary).toMatch(/^Pick the best of 4 stills/);
    expect(p.say).toMatch(/4 stills first.*tell me which one to animate/);
    const plan = tools.planFor(p.tool, p.input, { engine: "cloud" });
    expect(plan.jobs).toMatchObject([{ kind: "image", op: "t2i", count: 4 }]);
    // The same request with a plural noun and a "best one" also asks.
    const fox = agent.offlinePlan("Make 3 portraits of a fox in a trench coat, then animate the best one into a 5 s video", "open")!;
    expect(jobsOf(fox)).toEqual([expect.objectContaining({ model_id: "oss-z-image-turbo", outputs: 3, prompt: "Portrait of a fox in a trench coat" })]);
    // "… then animate them": every still gets its own clip.
    const all = agent.offlinePlan("Two posters of a jazz club, then animate them", "cloud")!;
    expect(jobsOf(all).map((j) => [j.model_id, j.after])).toEqual([
      ["nano-banana-pro", undefined],
      ["seedance-2-5", 0],
      ["nano-banana-pro", undefined],
      ["seedance-2-5", 2],
    ]);
  });

  it("a 6-frame storyboard has six frames", () => {
    expect(agent.offlinePlan(ASSIST_SUGGESTIONS[2], "cloud")).toMatchObject({ tool: "create_storyboard", input: { frames: 6 } });
  });

  it("a 10-second vertical video with sound: the length the model lists and its own soundtrack", () => {
    expect(jobsOf(agent.offlinePlan(ASSIST_SUGGESTIONS[3], "cloud"))).toEqual([
      expect.objectContaining({ model_id: "seedance-2-5", aspect_ratio: "9:16", duration: 10, generate_audio: true }),
    ]);
    // The open model's longest is 5 s, and it makes no sound.
    const open = jobsOf(agent.offlinePlan(ASSIST_SUGGESTIONS[3], "open"))[0];
    expect(open).toMatchObject({ model_id: "oss-wan22-14b-fast", aspect_ratio: "9:16", duration: 5 });
    expect(open.generate_audio).toBeUndefined();
  });

  it("drops the count from a counted prompt so each take is one picture", () => {
    expect(jobsOf(agent.offlinePlan("4 portraits of a jazz singer in a smoky club", "cloud"))[0]).toMatchObject({ outputs: 4, prompt: "Portrait of a jazz singer in a smoky club" });
    // Without a count the words stay as written.
    expect(jobsOf(agent.offlinePlan("a cozy cafe", "cloud"))[0]).toMatchObject({ prompt: "a cozy cafe" });
  });
});

describe("picking a take", () => {
  it("reads short replies that name one take", () => {
    expect(agent.pickedTake("animate 2")).toEqual({ take: 2, animate: true });
    expect(agent.pickedTake("Animate the second one, please.")).toEqual({ take: 2, animate: true });
    expect(agent.pickedTake("2")).toEqual({ take: 2, animate: false });
    expect(agent.pickedTake("#3")).toEqual({ take: 3, animate: false });
    expect(agent.pickedTake("the third one")).toEqual({ take: 3, animate: false });
    expect(agent.pickedTake("go with the last one")).toEqual({ take: -1, animate: false });
    expect(agent.pickedTake("number 1")).toEqual({ take: 1, animate: false });
    // New requests aren't picks.
    expect(agent.pickedTake("Animate 2 portraits of a cat")).toBeNull();
    expect(agent.pickedTake("a lighthouse at dawn")).toBeNull();
    expect(agent.pickedTake("2 cats on a sofa")).toBeNull();
    expect(agent.pickedTake("make it 2 seconds longer and moodier")).toBeNull();
  });

  it("asks which still to animate, then animates the one picked", async () => {
    const t = agent.createThread({ agent: "offline", engine: "cloud", autoApprove: true });
    agent.addMessage(t.id, ASSIST_SUGGESTIONS[1]);
    await agent.run(t.id, agent.offline);
    let v = agent.getThread(t.id)!;
    const said = v.thread.items.filter((i) => i.role === "assistant").map((i) => (i as { text: string }).text);
    expect(said.at(-1)).toMatch(/tell me which one to animate: reply "animate 2"/);
    expect(v.generations).toHaveLength(1);
    const still = v.generations[0];
    expect(still.request.params?.numOutputs).toBe(4);

    // Still rendering: it says so.
    db().prepare("UPDATE generations SET status = 'running' WHERE id = ?").run(still.id);
    agent.addMessage(t.id, "2");
    await agent.run(t.id, agent.offline);
    v = agent.getThread(t.id)!;
    expect((v.thread.items.at(-1) as { text: string }).text).toMatch(/still rendering/);

    const outputs = [1, 2, 3, 4].map((n) => ({ url: `/api/files/outputs/take-${n}.png`, kind: "image", contentType: "image/png" }));
    db().prepare("UPDATE generations SET status = 'succeeded', outputs_json = ? WHERE id = ?").run(JSON.stringify(outputs), still.id);
    // Asked again after the "still rendering" reply: a bare number still answers it.
    agent.addMessage(t.id, "animate 2");
    await agent.run(t.id, agent.offline);
    v = agent.getThread(t.id)!;
    const clip = v.generations.find((g) => g.kind === "video")!;
    expect(clip).toBeTruthy();
    expect(clip.request).toMatchObject({ modelId: "seedance-2-5", inputs: { images: ["/api/files/outputs/take-2.png"] } });
    expect(clip.request.prompt).toMatch(/^Moody portrait of a lighthouse keeper, 35mm film\. The still comes to life/);
    expect(v.thread.items.filter((i) => i.role === "assistant").map((i) => (i as { text: string }).text)).toContain("I'll animate take 2 with the default video model.");
  });

  it("a number with no stills in the chat is a new request", async () => {
    const t = agent.createThread({ agent: "offline", engine: "cloud" });
    agent.addMessage(t.id, "animate 2");
    await agent.run(t.id, agent.offline);
    const v = agent.getThread(t.id)!;
    expect(v.thread.items.some((i) => i.role === "approval")).toBe(true);
  });
});
