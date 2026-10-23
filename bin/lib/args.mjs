// Command-line parsing for the fuobe CLI: long and short options, repeatable options,
// `--name=value`, `--no-<flag>`, `--` and errors that say what to type instead. Pure (no I/O).

/** A mistake in how the command was typed: printed with the command's usage, exit code 2. */
export class UsageError extends Error {
  /** @param {string} message @param {string} [command] */
  constructor(message, command) {
    super(message);
    this.command = command;
  }
}

/**
 * @typedef {object} OptionSpec
 * @property {"string" | "number" | "boolean"} type
 * @property {string} [short] one-letter alias
 * @property {boolean} [multiple] can be given more than once (the values come back as a list)
 * @property {string[]} [choices]
 * @property {string} [value] the placeholder shown in help ("file", "id")
 * @property {string} [describe]
 */

/** Options every command takes. */
export const GLOBAL_OPTIONS = /** @type {Record<string, OptionSpec>} */ ({
  json: { type: "boolean", describe: "Print machine-readable JSON on stdout" },
  url: { type: "string", value: "url", describe: "The Fuobe server (default: FUOBE_URL, then fuobe login, then http://localhost:3000)" },
  token: { type: "string", value: "token", describe: "An API token (default: FUOBE_TOKEN, then fuobe login)" },
  help: { type: "boolean", short: "h", describe: "Show help for the command" },
});

/** Edit distance where swapping two neighbouring letters counts once ("modle" → "model"), for "did you mean". */
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** The closest of `names` to `word`, if it's close enough to be a typo. */
export function suggest(word, names) {
  let best = null;
  let bestD = Infinity;
  for (const n of names) {
    const d = distance(word, n);
    if (d < bestD) [best, bestD] = [n, d];
  }
  return best !== null && bestD <= Math.max(1, Math.floor(word.length / 3)) ? best : null;
}

function convert(name, spec, raw, command) {
  if (spec.type === "number") {
    const n = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(n)) throw new UsageError(`--${name} takes a number, not “${raw}”`, command);
    return n;
  }
  if (spec.choices && !spec.choices.includes(raw)) {
    const near = suggest(raw, spec.choices);
    throw new UsageError(`--${name} is one of ${spec.choices.join(", ")}${near ? ` (did you mean ${near}?)` : ""}, not “${raw}”`, command);
  }
  return raw;
}

/**
 * Parse `argv` against a command's options (plus the global ones).
 * @param {string[]} argv
 * @param {Record<string, OptionSpec>} options
 * @param {string} [command] named in errors
 * @returns {{ values: Record<string, any>, positionals: string[] }}
 */
export function parseArgs(argv, options, command) {
  const specs = { ...GLOBAL_OPTIONS, ...options };
  const byShort = new Map(Object.entries(specs).flatMap(([name, s]) => (s.short ? [[s.short, name]] : [])));
  /** @type {Record<string, any>} */
  const values = {};
  const positionals = [];
  const set = (name, spec, value) => {
    if (spec.multiple) (values[name] ??= []).push(value);
    else values[name] = value;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    let name;
    let inline;
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      inline = eq === -1 ? undefined : arg.slice(eq + 1);
      if (!specs[name] && name.startsWith("no-") && specs[name.slice(3)]?.type === "boolean") {
        if (inline !== undefined) throw new UsageError(`--${name} doesn't take a value`, command);
        values[name.slice(3)] = false;
        continue;
      }
    } else if (/^-[A-Za-z]$/.test(arg)) {
      name = byShort.get(arg.slice(1));
      if (!name) throw new UsageError(`Unknown option ${arg}`, command);
    } else {
      // "-" alone (stdin) and negative numbers are values.
      positionals.push(arg);
      continue;
    }
    const spec = specs[name];
    if (!spec) {
      const near = suggest(name, Object.keys(specs));
      throw new UsageError(`Unknown option --${name}${near ? ` — did you mean --${near}?` : ""}`, command);
    }
    if (spec.type === "boolean") {
      if (inline !== undefined && !/^(true|false)$/.test(inline)) throw new UsageError(`--${name} doesn't take a value`, command);
      set(name, spec, inline !== "false");
      continue;
    }
    let raw = inline;
    if (raw === undefined) {
      if (i + 1 >= argv.length || (argv[i + 1].startsWith("--") && argv[i + 1].length > 2)) throw new UsageError(`--${name} needs a ${spec.value ?? "value"}`, command);
      raw = argv[++i];
    }
    set(name, spec, convert(name, spec, raw, command));
  }
  return { values, positionals };
}

/** `key=value` pairs (from --param / --arg): numbers, booleans and JSON are read as such, the rest stays text. */
export function keyValue(pair, flag = "--param") {
  const eq = pair.indexOf("=");
  if (eq <= 0) throw new UsageError(`${flag} takes key=value, not “${pair}”`);
  const key = pair.slice(0, eq).trim();
  const raw = pair.slice(eq + 1);
  let value = raw;
  if (/^(-?\d+(\.\d+)?|true|false|null)$/.test(raw.trim()) || /^[[{"]/.test(raw.trim())) {
    try {
      value = JSON.parse(raw);
    } catch {
      value = raw;
    }
  }
  return [key, value];
}
