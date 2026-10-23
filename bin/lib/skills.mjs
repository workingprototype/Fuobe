// `fuobe skills add`: where a skill comes from (a SKILL.md, a .zip / .skill, a folder, a git repo
// or a link), finding the skills in a folder the way the open `skills` CLI does, and packing one
// skill folder for /api/assist/skills/upload.
import fs from "node:fs";
import path from "node:path";
import { UsageError } from "./args.mjs";
import { zipFiles } from "./zip.mjs";

/** Text files a skill may carry next to SKILL.md (the server keeps these, and drops the rest). */
export const TEXT_FILE = /\.(md|markdown|txt|json|ya?ml|csv|tsv|srt|vtt|html?|css|xml|js|mjs|ts|py|sh)$/i;
/** The server's limits for the files beside SKILL.md. */
export const MAX_FILES = 30;
export const MAX_FILES_BYTES = 400_000;

/** Folders the `skills` CLI looks in (the common ones; see its docs/creating-skills.md). */
const CONTAINERS = ["skills", "skills/.curated", "skills/.experimental", "skills/.system", ".agents/skills", ".claude/skills", "data/skills"];
const SKIP = new Set(["node_modules", ".git", "dist", "build", "__pycache__", ".next"]);

/**
 * What `fuobe skills add <source>` was given.
 * @param {string} source
 * @param {(p: string) => fs.Stats | null} stat a stat that returns null for a missing path
 * @returns {{ type: "markdown" | "archive" | "dir", path: string } | { type: "git", url: string, ref?: string, subpath?: string } | { type: "link", url: string }}
 */
export function parseSource(source, stat) {
  const s = source.trim();
  const st = stat(s);
  if (st?.isDirectory()) return { type: "dir", path: s };
  if (st?.isFile()) {
    if (/\.(zip|skill)$/i.test(s)) return { type: "archive", path: s };
    if (/\.(md|markdown)$/i.test(s)) return { type: "markdown", path: s };
    throw new UsageError(`${s} isn't a skill: give a SKILL.md, a .zip or .skill archive, a folder or a git repository`, "skills");
  }
  // https://github.com/owner/repo/tree/<ref>/<path>: one folder of a repository.
  const tree = /^https:\/\/(github\.com|gitlab\.com)\/([^/]+)\/([^/]+?)(?:\.git)?\/(?:-\/)?tree\/([^/]+)(?:\/(.+?))?\/?$/.exec(s);
  if (tree) return { type: "git", url: `https://${tree[1]}/${tree[2]}/${tree[3]}.git`, ref: tree[4], ...(tree[5] && { subpath: tree[5] }) };
  if (/^https?:\/\/.+\.(zip|skill|md)(\?.*)?$/i.test(s)) return { type: "link", url: s };
  if (/^(https?:\/\/|ssh:\/\/|git@|git:\/\/|file:\/\/)/.test(s) || /\.git$/.test(s)) return { type: "git", url: s };
  // owner/repo: GitHub, as `npx skills add owner/repo` reads it.
  if (/^[\w.-]+\/[\w.-]+$/.test(s) && !s.startsWith(".")) return { type: "git", url: `https://github.com/${s.replace(/\.git$/, "")}.git` };
  throw new UsageError(`Can't find ${s}. Give a SKILL.md, a .zip or .skill archive, a folder, owner/repo or a git URL.`, "skills");
}

/** The frontmatter fields `skills add` needs: the name, and whether it's marked internal. */
export function skillHead(markdown) {
  const fm = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)?.[1] ?? "";
  const name = /^name:\s*["']?([^"'\r\n#]+?)["']?\s*(?:#.*)?$/m.exec(fm)?.[1]?.trim() ?? null;
  // metadata.internal: true (the skills CLI hides these unless asked for by name).
  const internal = /^metadata:\s*\r?\n(?:[ \t]+.*\r?\n)*?[ \t]+internal:\s*true\s*$/m.test(fm);
  return { name, internal };
}

/**
 * Skill folders under `root`: the root itself when it has a SKILL.md, else the usual container
 * folders (and folders right under the root) up to three levels deep, else any SKILL.md up to five
 * levels down. A SKILL.md shadows anything nested below it.
 * @returns {string[]} folder paths
 */
export function findSkillDirs(root) {
  const has = (dir) => fs.existsSync(path.join(dir, "SKILL.md"));
  if (has(root)) return [root];
  const found = [];
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP.has(e.name)) continue;
      const sub = path.join(dir, e.name);
      if (has(sub)) found.push(sub);
      else if (depth > 1) walk(sub, depth - 1);
    }
  };
  walk(root, 1);
  for (const c of CONTAINERS) if (fs.existsSync(path.join(root, c))) walk(path.join(root, c), 3);
  if (!found.length) walk(root, 5);
  return [...new Set(found.map((d) => path.resolve(d)))].sort();
}

/**
 * One skill folder as a zip for the upload: SKILL.md and the text files beside it (skipping
 * dot-files, binaries and anything past the server's limits, which are listed in `skipped`).
 */
export function packSkill(dir) {
  const folder = path.basename(path.resolve(dir));
  const files = [{ name: `${folder}/SKILL.md`, data: fs.readFileSync(path.join(dir, "SKILL.md")) }];
  const skipped = [];
  let bytes = 0;
  const walk = (sub) => {
    for (const e of fs.readdirSync(path.join(dir, sub), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = sub ? `${sub}/${e.name}` : e.name;
      if (e.name.startsWith(".") || SKIP.has(e.name)) continue;
      if (e.isDirectory()) {
        walk(rel);
        continue;
      }
      if (!e.isFile() || rel === "SKILL.md") continue;
      const data = fs.readFileSync(path.join(dir, rel));
      if (!TEXT_FILE.test(rel) || data.includes(0) || files.length > MAX_FILES || bytes + data.length > MAX_FILES_BYTES) {
        skipped.push(rel);
        continue;
      }
      bytes += data.length;
      files.push({ name: `${folder}/${rel}`, data });
    }
  };
  walk("");
  return { zip: zipFiles(files), files: files.map((f) => f.name.slice(folder.length + 1)), skipped };
}
