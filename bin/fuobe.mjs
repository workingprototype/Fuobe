#!/usr/bin/env node
// fuobe: the Fuobe command line (Node 20+, no dependencies). It talks to a Fuobe server's REST API
// and MCP endpoint; see docs/cli.md. The logic is in ./lib so tests can drive it without a terminal.
import os from "node:os";
import readline from "node:readline";
import { main } from "./lib/cli.mjs";

/** Ask on the terminal; `hidden` keeps a pasted token off the screen. */
function ask(question, { hidden = false } = {}) {
  const { stdin, stderr } = process;
  if (!hidden || !stdin.isTTY) {
    const rl = readline.createInterface({ input: stdin, output: stderr });
    return new Promise((resolve) => rl.question(question, (answer) => (rl.close(), resolve(answer))));
  }
  return new Promise((resolve, reject) => {
    stderr.write(question);
    let value = "";
    const done = (fn) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stderr.write("\n");
      fn();
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return done(() => resolve(value));
        if (ch === "\u0003") return done(() => reject(new Error("Canceled")));
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function readStdin() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

process.exitCode = await main(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
  cwd: process.cwd(),
  home: os.homedir(),
  fetch: globalThis.fetch,
  columns: process.stdout.columns || 100,
  stdinIsTTY: !!process.stdin.isTTY,
  stderrIsTTY: !!process.stderr.isTTY,
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  /** Ctrl+C while waiting stops the wait (the job keeps running on the server). */
  onInterrupt: (fn) => {
    process.on("SIGINT", fn);
    return () => process.off("SIGINT", fn);
  },
  ask,
  readStdin,
});
