// A stand-in for nvidia-smi (the worker's GPU check, bin/lib/worker/gpu.mjs): it answers the queries the worker makes
// from a JSON file the test writes: { "usedMb": 900, "tempC": 50, "busyPct": 97, "computeCap": "8.9", "apps": [{ "pid": 1, "name":
// "python.exe", "usedMb": null }] } (usedMb null prints [N/A], as Windows does; no computeCap: an older nvidia-smi).
// "statsLine": the whole answer to the worker's full query (with power.draw and the rest). "refuseFull": true answers
// that query as an nvidia-smi that doesn't know one of its fields (an error), so the worker asks the short one.
//
//   node tests/helpers/fake-nvidia-smi.mjs <state.json> --query-gpu=memory.used,temperature.gpu --format=csv,noheader,nounits
import fs from "node:fs";

const [file, ...args] = process.argv.slice(2);
const s = JSON.parse(fs.readFileSync(file, "utf8"));
if (args.includes("--query-gpu=compute_cap")) {
  if (!s.computeCap) process.exit(2);
  process.stdout.write(`${s.computeCap}\n`);
} else if (args.some((a) => a.startsWith("--query-gpu") && a.includes("power.draw"))) {
  if (s.refuseFull) process.exit(2);
  process.stdout.write(`${s.statsLine ?? `${s.usedMb}, ${s.tempC ?? 40}, ${s.busyPct ?? "[N/A]"}`}\n`);
} else if (args.some((a) => a.startsWith("--query-gpu"))) process.stdout.write(`${s.usedMb}, ${s.tempC ?? 40}, ${s.busyPct ?? "[N/A]"}\n`);
else if (args.some((a) => a.startsWith("--query-compute-apps"))) for (const a of s.apps ?? []) process.stdout.write(`${a.pid}, ${a.name}, ${a.usedMb === null || a.usedMb === undefined ? "[N/A]" : a.usedMb}\n`);
else process.exit(2);
