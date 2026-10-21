import { describe, expect, it } from "vitest";
import { extractOutputs, noOutputsError, textDataUri, wordsToCues } from "@/lib/catalog/payload";

// Response fixtures follow docs/research/paid-model-apis-3.json → outputFields / outputShape of each endpoint.
const file = (url: string, content_type?: string) => ({ url, file_name: url.split("/").pop(), file_size: 1234, ...(content_type ? { content_type } : {}) });
const decode = (uri: string) => Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64").toString("utf8");

describe("layers", () => {
  it("Seedream layerize: base + named layers with z order and [x, y, w, h] boxes", () => {
    const base = { ...file("https://v3.fal.media/files/base.png", "image/png"), width: 1024, height: 768 };
    const mug = { ...file("https://v3.fal.media/files/mug.png", "image/png"), width: 300, height: 400 };
    const res = {
      layers: [
        { image: base, z_index: 0 },
        {
          image: mug,
          z_index: 1,
          name: "Red mug",
          description: "A red ceramic mug with steam",
          bounding_box: { absolute: [100, 200, 400, 600], normalized: [98, 260, 391, 781] },
        },
      ],
      images: [base, mug],
    };
    expect(extractOutputs(res, "layers")).toEqual([
      { url: base.url, kind: "image", contentType: "image/png", meta: { name: "Background", z: 0 } },
      {
        url: mug.url,
        kind: "image",
        contentType: "image/png",
        meta: { name: "Red mug", z: 1, bbox: [100, 200, 300, 400], bboxNormalized: [98, 260, 293, 521], description: "A red ceramic mug with steam" },
      },
    ]);
  });

  it("Qwen layered (fal images[] and Replicate output[]): stacking order is array order", () => {
    const fal = {
      images: [file("https://v3.fal.media/files/l0.png", "image/png"), file("https://v3.fal.media/files/l1.png", "image/png"), file("https://v3.fal.media/files/l2.png", "image/png")],
      seed: 42,
      prompt: "a poster",
      has_nsfw_concepts: [false, false, false],
      timings: { inference: 3.2 },
    };
    expect(extractOutputs(fal, "layers").map((o) => o.meta)).toEqual([
      { name: "Background", z: 0 },
      { name: "Layer 1", z: 1 },
      { name: "Layer 2", z: 2 },
    ]);
    const rep = { output: ["https://replicate.delivery/x/out-0.webp", "https://replicate.delivery/x/out-1.webp"] };
    expect(extractOutputs(rep, "layers")).toEqual([
      { url: rep.output[0], kind: "image", meta: { name: "Background", z: 0 } },
      { url: rep.output[1], kind: "image", meta: { name: "Layer 1", z: 1 } },
    ]);
  });

  it("Ideogram layerize-text: the clean background carries the text blocks and overlay HTML", () => {
    const containers = [{ id: "c1", items: [{ spans: [{ text: "BIG" }, { text: "SUMMER" }] }, { spans: [{ text: "SALE" }] }], left: 40, top: 60 }];
    const res = {
      image: file("https://v3.fal.media/files/clean.png", "image/png"),
      text_containers: containers,
      text_html: "<div class='c1'>BIG SUMMER SALE</div>",
      image_layers: [{ url: "https://v3.fal.media/files/logo.png", name: "Logo" }],
      seed: 7,
      prompt: "poster",
    };
    const out = extractOutputs(res, "text-layers");
    expect(out[0]).toEqual({
      url: "https://v3.fal.media/files/clean.png",
      kind: "image",
      contentType: "image/png",
      meta: { name: "Background", z: 0, textBlocks: [{ ...containers[0], text: "BIG SUMMER SALE" }], textHtml: res.text_html },
    });
    expect(out[1]).toEqual({ url: "https://v3.fal.media/files/logo.png", kind: "image", meta: { name: "Logo", z: 1 } });
  });
});

describe("transcripts", () => {
  it("Scribe v2: text output with a data URI the runner can store, and caption cues per speaker/sentence", () => {
    const res = {
      text: "Hello there. How are you?",
      language_code: "en",
      language_probability: 0.98,
      words: [
        { text: "Hello", start: 0, end: 0.4, type: "word", speaker_id: "speaker_0" },
        { text: " ", start: 0.4, end: 0.45, type: "spacing", speaker_id: "speaker_0" },
        { text: "there.", start: 0.45, end: 0.9, type: "word", speaker_id: "speaker_0" },
        { text: " ", start: 0.9, end: 1.5, type: "spacing", speaker_id: "speaker_1" },
        { text: "How", start: 1.5, end: 1.7, type: "word", speaker_id: "speaker_1" },
        { text: " ", start: 1.7, end: 1.75, type: "spacing", speaker_id: "speaker_1" },
        { text: "are", start: 1.75, end: 1.9, type: "word", speaker_id: "speaker_1" },
        { text: " ", start: 1.9, end: 1.95, type: "spacing", speaker_id: "speaker_1" },
        { text: "you?", start: 1.95, end: 2.3, type: "word", speaker_id: "speaker_1" },
      ],
    };
    const [o, ...rest] = extractOutputs(res, "transcribe");
    expect(rest).toEqual([]);
    expect(o).toMatchObject({ kind: "text", contentType: "text/plain", text: "Hello there. How are you?" });
    expect(o.url).toMatch(/^data:text\/plain;base64,/);
    expect(decode(o.url)).toBe(res.text);
    expect(o.meta).toEqual({
      language: "en",
      cues: [
        { start: 0, end: 0.9, text: "Hello there.", speaker: "speaker_0" },
        { start: 1.5, end: 2.3, text: "How are you?", speaker: "speaker_1" },
      ],
    });
  });

  it("Whisper / Wizper segment chunks are cues as they are; Replicate Scribe answers with an object", () => {
    const wizper = { text: " Hello there. How are you?", languages: ["en"], chunks: [{ timestamp: [0, 2.5], text: " Hello there." }, { timestamp: [2.5, 4.1], text: " How are you?" }] };
    expect(extractOutputs(wizper, "transcribe")[0].meta).toEqual({
      language: "en",
      cues: [
        { start: 0, end: 2.5, text: "Hello there." },
        { start: 2.5, end: 4.1, text: "How are you?" },
      ],
    });
    const rep = { output: { text: "Bonjour.", language_code: "fr", language_probability: 0.9, words: [{ text: "Bonjour.", start: 0.1, end: 0.6, type: "word" }] } };
    expect(extractOutputs(rep, "transcribe")).toEqual([
      { url: textDataUri("Bonjour."), kind: "text", contentType: "text/plain", text: "Bonjour.", meta: { language: "fr", cues: [{ start: 0.1, end: 0.6, text: "Bonjour." }] } },
    ]);
  });

  it("keeps UTF-8 intact in the data URI and wraps long lines into caption-sized cues", () => {
    expect(decode(textDataUri("Café — ✓ 日本語"))).toBe("Café — ✓ 日本語");
    const words = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen".split(" ").map((t, i) => ({ text: t, start: i * 0.3, end: i * 0.3 + 0.25 }));
    const cues = wordsToCues(words);
    expect(cues.length).toBeGreaterThan(1);
    expect(cues.every((c) => c.text.length <= 64)).toBe(true);
    expect(cues.map((c) => c.text).join(" ")).toBe(words.map((w) => w.text).join(" "));
  });

  it("Auto Subtitle: the captioned video keeps what was transcribed", () => {
    const res = {
      video: file("https://v3.fal.media/files/captioned.mp4", "video/mp4"),
      transcription: "Hello there",
      words: [
        { word: "Hello", start: 0, end: 0.5 },
        { word: "there", start: 0.5, end: 1 },
      ],
      subtitle_count: 1,
      transcription_metadata: { language: "en" },
    };
    expect(extractOutputs(res, "captions")).toEqual([
      {
        url: "https://v3.fal.media/files/captioned.mp4",
        kind: "video",
        contentType: "video/mp4",
        meta: { transcript: "Hello there", cues: [{ start: 0, end: 1, text: "Hello there" }] },
      },
    ]);
  });

  it("text-only answers become one text output instead of nothing", () => {
    expect(extractOutputs({ text: "A red mug on a table." })).toMatchObject([{ kind: "text", text: "A red mug on a table." }]);
    expect(extractOutputs({ output: ["A ", "red ", "mug"] })).toMatchObject([{ kind: "text", text: "A red mug" }]);
    expect(extractOutputs({ seed: 1, timings: {} })).toEqual([]);
    // Text operations answer in text too; a plain answer has no empty cue list in its meta.
    expect(extractOutputs({ text: "Hola." }, "translate")).toMatchObject([{ kind: "text", text: "Hola.", meta: {} }]);
    expect(extractOutputs({ text: "Hola." }, "transcribe")[0].meta).toEqual({});
  });

  it("a media operation's text-only answer (a refusal) is no result, and its words become the error", () => {
    const refusal = { images: [], text: "Sorry, I can't make that." };
    expect(extractOutputs(refusal, "t2i")).toEqual([]);
    expect(extractOutputs({ output: "I can't help with that." }, "t2v")).toEqual([]);
    expect(noOutputsError(refusal)).toBe("The model replied: Sorry, I can't make that.");
    expect(noOutputsError({ seed: 1 })).toMatch(/^No media in response: \{"seed":1\}/);
  });
});

describe("3D models, stems and other extras", () => {
  it("Hunyuan3D: the GLB as a model3d output, with the other formats and the preview in meta", () => {
    const res = {
      model_glb: file("https://v3.fal.media/files/model.glb", "application/octet-stream"),
      thumbnail: file("https://v3.fal.media/files/thumb.png", "image/png"),
      model_urls: { glb: file("https://v3.fal.media/files/model.glb"), obj: file("https://v3.fal.media/files/model.obj"), fbx: null, usdz: null },
      seed: 3,
    };
    expect(extractOutputs(res, "image-to-3d")).toEqual([
      {
        url: "https://v3.fal.media/files/model.glb",
        kind: "model3d",
        contentType: "model/gltf-binary",
        meta: { preview: "https://v3.fal.media/files/thumb.png", formats: { glb: "https://v3.fal.media/files/model.glb", obj: "https://v3.fal.media/files/model.obj" } },
      },
    ]);
    const tripo = { model_mesh: file("https://v3.fal.media/files/mesh.glb", "model/gltf-binary"), rendered_image: file("https://v3.fal.media/files/render.webp"), task_id: "t1" };
    expect(extractOutputs(tripo, "image-to-3d")).toEqual([
      { url: "https://v3.fal.media/files/mesh.glb", kind: "model3d", contentType: "model/gltf-binary", meta: { preview: "https://v3.fal.media/files/render.webp" } },
    ]);
    expect(extractOutputs({ output: "https://replicate.delivery/x/model.glb" }, "image-to-3d")).toEqual([
      { url: "https://replicate.delivery/x/model.glb", kind: "model3d", contentType: "model/gltf-binary" },
    ]);
  });

  it("Demucs: one audio output per stem, voice first", () => {
    const res = {
      drums: file("https://v3.fal.media/files/drums.mp3", "audio/mpeg"),
      vocals: file("https://v3.fal.media/files/vocals.mp3", "audio/mpeg"),
      other: file("https://v3.fal.media/files/other.mp3", "audio/mpeg"),
      bass: file("https://v3.fal.media/files/bass.mp3", "audio/mpeg"),
      guitar: null,
      piano: null,
    };
    expect(extractOutputs(res, "separate-audio").map((o) => [o.kind, o.meta?.stem])).toEqual([
      ["audio", "vocals"],
      ["audio", "drums"],
      ["audio", "bass"],
      ["audio", "other"],
    ]);
  });

  it("keeps Recraft's new style id and puts Bria's matte on the cut-out", () => {
    expect(extractOutputs({ images: [file("https://v3.fal.media/files/a.png", "image/png")], style_id: "style-9" }, "t2i")[0].meta).toEqual({ styleId: "style-9" });
    const cut = extractOutputs({ image: file("https://v3.fal.media/files/cut.png", "image/png"), mask: file("https://v3.fal.media/files/mask.png", "image/png") }, "edit");
    // One result in the feed: the matte rides along instead of being a second picture.
    expect(cut).toEqual([{ url: "https://v3.fal.media/files/cut.png", kind: "image", contentType: "image/png", meta: { mask: "https://v3.fal.media/files/mask.png" } }]);
  });

  it("plain media responses come back unchanged", () => {
    expect(extractOutputs({ audio: [file("https://v3.fal.media/files/a.wav", "audio/wav"), file("https://v3.fal.media/files/b.wav", "audio/wav")], seeds: [1, 2] }, "sfx")).toEqual([
      { url: "https://v3.fal.media/files/a.wav", kind: "audio", contentType: "audio/wav" },
      { url: "https://v3.fal.media/files/b.wav", kind: "audio", contentType: "audio/wav" },
    ]);
    expect(extractOutputs({ image: file("https://v3.fal.media/files/logo.svg", "image/svg+xml") }, "vectorize")).toEqual([
      { url: "https://v3.fal.media/files/logo.svg", kind: "image", contentType: "image/svg+xml" },
    ]);
  });
});
