// The setup program's log (setup/main.mjs): what it found and did, at a fixed place it names at the end. A worker token
// never reaches it: every line goes through hideSecrets(), and the token itself is added to the words it hides.
import fs from "node:fs";
import path from "node:path";

/** Where the setup keeps its logs and reports: %LOCALAPPDATA%\Fuobe\worker-setup. */
export function setupLogDir(env = process.env, home = "") {
  return path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Fuobe", "worker-setup");
}

/** The local time for file names: 20261107-203015. */
export const stampOf = (d = new Date()) => {
  const two = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
};

/** Any worker token (fuobe_wkr_…), a Bearer value and each of `secrets`, hidden. */
export function hideSecrets(text, secrets = []) {
  let out = String(text).replace(/fuobe_wkr_[A-Za-z0-9_\-.]*/g, "fuobe_wkr_[hidden]").replace(/(Bearer\s+)\S+/gi, "$1[hidden]");
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join("[hidden]");
  return out;
}

export class SetupLog {
  constructor(file) {
    this.file = file;
    this.secrets = [];
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "");
  }

  /** A word that must never be written (the token, as soon as it is typed). */
  hide(secret) {
    if (secret) this.secrets.push(String(secret));
  }

  line(text) {
    try {
      fs.appendFileSync(this.file, `[${new Date().toTimeString().slice(0, 8)}] ${hideSecrets(text, this.secrets)}\n`);
    } catch {}
  }
}
