// End-to-end check of the open-source engine against a live ComfyUI.
// Usage: node tests/e2e/comfyui-selftest.mjs [appUrl]   (app must be running, ComfyUI reachable)
// Uploads a PNG, runs the weight-free self-test workflows through /api/generations,
// waits for completion and verifies the saved outputs.
import zlib from "node:zlib";

const app = process.argv[2] ?? "http://localhost:3000";

function png(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = [0];
    for (let x = 0; x < w; x++) row.push((x * 255) / w, (y * 255) / h, 160);
    rows.push(Buffer.from(row));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function run(modelId, op, expectKind) {
  const form = new FormData();
  form.append("file", new Blob([png(64, 48)], { type: "image/png" }), "selftest.png");
  const up = await (await fetch(`${app}/api/uploads`, { method: "POST", body: form })).json();
  const res = await fetch(`${app}/api/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feature: "selftest", modelId, op, prompt: "self-test", inputs: { images: [up.url] } }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${modelId}: ${body.error}`);
  const id = body.items[0].id;
  const t0 = Date.now();
  for (;;) {
    const g = await (await fetch(`${app}/api/generations/${id}`)).json();
    if (g.status === "succeeded") {
      if (g.provider !== "comfyui") throw new Error(`${modelId} ran on ${g.provider}, not ComfyUI (is ComfyUI reachable from the app?)`);
      const out = g.outputs[0];
      const file = await fetch(`${app}${out.url}`);
      const bytes = Buffer.from(await file.arrayBuffer());
      if (out.kind !== expectKind || !bytes.length) throw new Error(`${modelId}: unexpected output ${JSON.stringify(out)}`);
      console.log(`✓ ${modelId}: ${out.kind} ${file.headers.get("content-type")} ${bytes.length} bytes in ${Date.now() - t0} ms`);
      return;
    }
    if (g.status === "failed" || g.status === "canceled") throw new Error(`${modelId}: ${g.status} — ${g.error}`);
    if (Date.now() - t0 > 120_000) throw new Error(`${modelId}: timed out (${g.status} ${g.message ?? ""})`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

await run("oss-selftest-image", "edit", "image");
await run("oss-selftest-video", "i2v", "video");
console.log("ComfyUI engine OK");
