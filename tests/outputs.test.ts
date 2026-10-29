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

  it("stems sort voice first, then music and effects (DBS names), then instruments and the backgrounds", () => {
    const res = {
      residual: file("https://v3.fal.media/files/rest.wav", "audio/wav"),
      effects: file("https://v3.fal.media/files/fx.wav", "audio/wav"),
      drums: file("https://v3.fal.media/files/drums.wav", "audio/wav"),
      music: file("https://v3.fal.media/files/music.wav", "audio/wav"),
      sfx: file("https://v3.fal.media/files/sfx.wav", "audio/wav"),
      speech: file("https://v3.fal.media/files/speech.wav", "audio/wav"),
    };
    expect(extractOutputs(res, "separate-audio").map((o) => o.meta?.stem)).toEqual(["speech", "music", "sfx", "effects", "drums", "residual"]);
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

// Round 4: response fixtures follow docs/research/paid-model-apis-4.json → outputShape / outputFields.
describe("round-4 structured outputs", () => {
  it("Florence-2 OCR: the lines joined as text, each line's box as fractions of the picture", () => {
    const res = {
      results: {
        quad_boxes: [
          { x: 100, y: 50, w: 400, h: 60, label: "SUMMER SALE" },
          { x: 100, y: 130, w: 300, h: 30, label: " 50% off everything " },
          { x: 0, y: 0, w: 10, h: 10, label: "" },
        ],
      },
      image: { ...file("https://v3.fal.media/files/annotated.png", "image/png"), width: 1000, height: 500 },
    };
    const [out] = extractOutputs(res, "ocr");
    expect(out).toMatchObject({ kind: "text", contentType: "text/plain", text: "SUMMER SALE\n50% off everything" });
    expect(decode(out.url)).toBe("SUMMER SALE\n50% off everything");
    expect(out.meta).toEqual({
      lines: [
        { text: "SUMMER SALE", bbox: [0.1, 0.1, 0.4, 0.12] },
        { text: "50% off everything", bbox: [0.1, 0.26, 0.3, 0.06] },
      ],
      size: [1000, 500],
    });
    // No size in the answer: the boxes stay in pixels (bboxPx) for the caller to scale.
    expect(extractOutputs({ results: { quad_boxes: [{ x: 1, y: 2, w: 3, h: 4, label: "Hi" }] } }, "ocr")[0].meta).toEqual({ lines: [{ text: "Hi", bboxPx: [1, 2, 3, 4] }] });
    // Lines that are already normalized pass through; a picture without text is an empty text.
    expect(extractOutputs({ lines: [{ text: "Hello", bbox: [0.1, 0.2, 0.3, 0.05] }] }, "ocr")[0].meta).toEqual({ lines: [{ text: "Hello", bbox: [0.1, 0.2, 0.3, 0.05] }] });
    expect(extractOutputs({ results: { quad_boxes: [] }, image: { width: 10, height: 10 } }, "ocr")[0]).toMatchObject({ text: "", meta: { lines: [] } });
  });

  it("TripoSplat: the splat as a model3d .ply with meta.format, the cut-out it saw as the preview", () => {
    const res = {
      model_mesh: file("https://v3.fal.media/files/splat.ply", "application/octet-stream"),
      preprocessed_image: { ...file("https://v3.fal.media/files/cut.png", "image/png"), width: 512, height: 512 },
      seed: 1,
      num_gaussians: 262144,
    };
    expect(extractOutputs(res, "splat")).toEqual([
      { url: "https://v3.fal.media/files/splat.ply", kind: "model3d", contentType: "model/ply", meta: { format: "ply", preview: "https://v3.fal.media/files/cut.png" } },
    ]);
    expect(extractOutputs({ model_mesh: file("https://x/scene.spz") }, "splat")[0]).toMatchObject({ contentType: "model/x-spz", meta: { format: "spz" } });
  });

  it("SAM 3D Objects: the combined GLB, with the whole splat among its formats", () => {
    const res = {
      model_glb: file("https://v3.fal.media/files/objects.glb", "model/gltf-binary"),
      gaussian_splat: file("https://v3.fal.media/files/objects.ply"),
      individual_splats: [file("https://v3.fal.media/files/o1.ply")],
      metadata: [{ object_index: 0 }],
    };
    expect(extractOutputs(res, "image-to-3d")).toEqual([
      { url: "https://v3.fal.media/files/objects.glb", kind: "model3d", contentType: "model/gltf-binary", meta: { formats: { splat: "https://v3.fal.media/files/objects.ply" } } },
    ]);
  });

  it("Meshy rigging: the animated GLB when a preset was asked for, the rig and walk / run cycles in meta.formats", () => {
    const basic = { walking_glb: file("https://x/walk.glb"), running_glb: file("https://x/run.glb"), walking_fbx: file("https://x/walk.fbx") };
    const rigged = { rigged_character_glb: file("https://x/rig.glb"), rigged_character_fbx: file("https://x/rig.fbx"), basic_animations: basic, rig_task_id: "r1" };
    expect(extractOutputs(rigged, "rig-3d")).toEqual([
      { url: "https://x/rig.glb", kind: "model3d", contentType: "model/gltf-binary", meta: { rigged: true, formats: { fbx: "https://x/rig.fbx", walking: "https://x/walk.glb", running: "https://x/run.glb" } } },
    ]);
    const animated = extractOutputs({ ...rigged, animation_glb: file("https://x/dance.glb"), animation_fbx: file("https://x/dance.fbx") }, "rig-3d");
    expect(animated[0]).toMatchObject({ url: "https://x/dance.glb", meta: { rigged: true, animated: true, formats: { fbx: "https://x/dance.fbx", rigged: "https://x/rig.glb" } } });
    // Text to 3D (Tripo H3.1) reads like image to 3D.
    expect(extractOutputs({ model_mesh: file("https://x/lantern.glb"), rendered_image: file("https://x/r.webp") }, "text-to-3d")[0]).toMatchObject({ kind: "model3d", meta: { preview: "https://x/r.webp" } });
  });

  it("SDR to HDR: Topaz's HDR file is the result; LTX's EXR frames ride along on the SDR preview", () => {
    expect(extractOutputs({ video: file("https://x/hdr.mp4", "video/mp4") }, "sdr-to-hdr")).toEqual([{ url: "https://x/hdr.mp4", kind: "video", contentType: "video/mp4" }]);
    const ltx = { exr_frames_url: file("https://x/frames.zip", "application/zip"), preview_video: file("https://x/preview.mp4", "video/mp4"), prompt: "p", seed: 2 };
    expect(extractOutputs(ltx, "sdr-to-hdr")).toEqual([{ url: "https://x/preview.mp4", kind: "video", contentType: "video/mp4", meta: { preview: "sdr", artifacts: { exr: "https://x/frames.zip" } } }]);
  });

  it("extract frames: the images in order, each with meta.index", () => {
    const res = { images: [file("https://x/f0.png", "image/png"), file("https://x/f1.png", "image/png"), file("https://x/f2.png", "image/png")], frame_count: 3 };
    expect(extractOutputs(res, "extract-frames").map((o) => [o.url, o.meta?.index])).toEqual([
      ["https://x/f0.png", 0],
      ["https://x/f1.png", 1],
      ["https://x/f2.png", 2],
    ]);
  });
});
