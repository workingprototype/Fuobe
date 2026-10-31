/**
 * The commands Workflows → "Copy install commands" puts on the clipboard for one workflow: its custom node packs, then
 * the model files it still lacks. Pure (no I/O), so it can be tested and run in the browser.
 */
import type { ManifestModel, ManifestWorkflow } from "./comfy";
import { FUOBE_REPO } from "./connections";
import { modelCardOf } from "./licences";

type Installable = Pick<ManifestWorkflow, "customNodes"> & { models: (ManifestModel & { present?: boolean | null })[] };

/** The workflow library's folder on GitHub. */
export const WORKFLOWS_ON_GITHUB = `${FUOBE_REPO}/tree/main/workflows/comfyui`;

/** A workflow's graph in Fuobe's repo: the file itself (to download), and its page on GitHub. */
export function workflowSource(file: string): { raw: string; page: string } {
  const at = `workflows/comfyui/${file}`;
  return { raw: `${FUOBE_REPO.replace("https://github.com/", "https://raw.githubusercontent.com/")}/main/${at}`, page: `${FUOBE_REPO}/blob/main/${at}` };
}

/**
 * A pinned GitHub address the manifest links to (…/tree/<commit>, or …/tree/<commit>/<folder> for a pack that lives
 * in a folder of a bigger repo): the repo to clone, the commit, and the folder. Undefined for a plain repo address.
 */
export function pinnedRepo(url: string): { repo: string; ref: string; dir?: string } | undefined {
  const m = /^(https:\/\/github\.com\/[^/]+\/[^/]+?)(?:\.git)?\/tree\/([^/]+)(?:\/(.+?))?\/?$/.exec(url);
  return m ? { repo: m[1], ref: m[2], ...(m[3] ? { dir: m[3] } : {}) } : undefined;
}

/**
 * The commands that install one node pack into $COMFYUI/custom_nodes/<name>, safe to run again, as
 * scripts/comfy/install-comfyui.sh does. git can't clone a /tree/ page address, so a pinned pack is cloned from its
 * repo (an existing clone is kept), then the commit fetched and checked out, so an older checkout moves to the pin; a
 * pack in a folder of a bigger repo (h3_character_swap) is copied out of a sparse checkout at that commit, unless it's
 * already there.
 */
export function nodeInstall(node: { name: string; repo: string }): string {
  const pin = pinnedRepo(node.repo);
  if (!pin) return `git -C "$COMFYUI/custom_nodes" clone ${node.repo}`;
  const dest = `"$COMFYUI/custom_nodes/${node.name}"`;
  if (!pin.dir) {
    return [
      `{ [ -d "$COMFYUI/custom_nodes/${node.name}/.git" ] || git clone ${pin.repo} ${dest}; } \\`,
      `  && { git -C ${dest} fetch -q --depth 1 origin ${pin.ref} 2>/dev/null || true; } && git -C ${dest} checkout -q ${pin.ref}`,
    ].join("\n");
  }
  return [
    `[ -d ${dest} ] || { tmp="$(mktemp -d)" && git clone -q --filter=blob:none --no-checkout ${pin.repo} "$tmp" \\`,
    `  && git -C "$tmp" sparse-checkout set --no-cone /${pin.dir}/ && git -C "$tmp" checkout -q ${pin.ref} \\`,
    `  && cp -r "$tmp/${pin.dir}" ${dest}; rm -rf "$tmp"; }`,
  ].join("\n");
}

export function installScript(wf: Installable): string {
  // Optional alternatives (FILM for RIFE) are listed on the card, not installed by default. A file under a subfolder
  // (DBS: models/dbs/DBS-BSRNN-DnR/model.safetensors) gets that folder made first.
  const missing = wf.models.filter((m) => m.url && m.present !== true && !m.optional);
  // A gated download (LTX-2.5) answers 401 until its licence is accepted on Hugging Face and a token comes with it.
  const gated = [...new Set(missing.filter((m) => m.gated).map((m) => modelCardOf(m.url) ?? m.url!))];
  const accept = gated.map((page) => `# Gated: accept the licence at ${page}, then export HF_TOKEN=<your Hugging Face token>`);
  const lines = missing.map((m) => {
    const sub = m.file.includes("/") ? `/${m.file.slice(0, m.file.lastIndexOf("/"))}` : "";
    const token = m.gated ? ` --header="Authorization: Bearer $HF_TOKEN"` : "";
    return `mkdir -p "$COMFYUI/models/${m.folder}${sub}" && wget -c${token} -O "$COMFYUI/models/${m.folder}/${m.file}" "${m.url}"`;
  });
  return ["COMFYUI=${COMFYUI:-$HOME/ComfyUI}", ...wf.customNodes.map(nodeInstall), ...accept, ...lines].join("\n");
}

// ---------------------------------------------------------------------------
// "Use the ComfyUI on this computer": the one setting ComfyUI needs (its cross-site header naming this site), and the
// way to get it for the install the person has.

/** How the person's ComfyUI was installed, which says where its setting goes. */
export type ComfyInstall = "desktop" | "portable" | "stability-matrix" | "terminal";

export type Platform = "windows" | "mac" | "linux" | "other";

/** A site address the setting may name: no path, no quotes, nothing a start file could run. */
export const SAFE_ORIGIN = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/;

/** ComfyUI's launch setting for this site (only this site, never every site). */
export function corsFlag(origin: string): string {
  if (!SAFE_ORIGIN.test(origin)) throw new Error("That isn't a site address");
  return `--enable-cors-header ${origin}`;
}

/** The person's computer, from the browser's own words. */
export function platformOf(nav: { userAgentData?: { platform?: string }; userAgent?: string; platform?: string }): Platform {
  const p = `${nav.userAgentData?.platform ?? ""} ${nav.platform ?? ""} ${nav.userAgent ?? ""}`.toLowerCase();
  if (/win/.test(p)) return "windows";
  if (/mac|iphone|ipad/.test(p)) return "mac";
  if (/linux|x11|cros/.test(p)) return "linux";
  return "other";
}

/**
 * Before the setting is on nothing of ComfyUI can be read, so the install is guessed from its port and the computer:
 * 8000 is ComfyUI Desktop, Windows on 8188 is the portable build or Easy-Install, a Mac or Linux on 8188 started it
 * from a terminal. The person can pick another.
 */
export function guessInstall(port: number, platform: Platform): ComfyInstall {
  if (port === 8000) return "desktop";
  return platform === "windows" ? "portable" : "terminal";
}

/** Once it can be read: the embedded Python of the portable builds, else the guess. */
export function installFromStats(stats: { system?: { embedded_python?: boolean } }, port: number, platform: Platform): ComfyInstall {
  if (stats.system?.embedded_python) return "portable";
  return guessInstall(port, platform);
}

export const START_FILE_NAME = "Start ComfyUI for Fuobe.bat";

export interface InstallFix {
  /** What to do, in a sentence. */
  lead: string;
  /** Where the setting is, step by step (Desktop, Stability Matrix). */
  path?: string[];
  /** What to copy: the whole setting, or only the address for a field that takes it. */
  copy: string;
  /** Windows portable or Easy-Install: a start file can do it. */
  startFile?: boolean;
}

/** The fix for each install, in the words the card shows. */
export function fixFor(install: ComfyInstall, origin: string): InstallFix {
  const flag = corsFlag(origin);
  switch (install) {
    case "desktop":
      return {
        lead: "In ComfyUI Desktop, open Settings, then Server-Config, and paste this into Enable CORS header. Restart when it asks.",
        path: ["Settings (the gear, bottom left)", "Server-Config", "Enable CORS header"],
        copy: origin,
      };
    case "stability-matrix":
      return {
        lead: "In Stability Matrix, open ComfyUI's Launch Options and add this to Extra Launch Arguments. Then stop and launch ComfyUI.",
        path: ["Packages", "ComfyUI's ⋮ menu", "Launch Options", "Extra Launch Arguments"],
        copy: flag,
      };
    case "portable":
      return {
        lead: "Download this start file and open it. It restarts ComfyUI with Fuobe allowed in, and keeps your other settings.",
        copy: flag,
        startFile: true,
      };
    default:
      return { lead: "Stop ComfyUI (Ctrl+C in its window) and start it again with this:", copy: `python main.py ${flag}` };
  }
}

/** Single quotes in a PowerShell string. */
const ps = (s: string) => `'${s.replaceAll("'", "''")}'`;

/**
 * "Start ComfyUI for Fuobe.bat", made in the browser for the port and this site: it finds the ComfyUI listening on the
 * port, asks before restarting it, and starts it again the same way with Fuobe's setting added. It leaves a start file
 * with that command next to ComfyUI, and offers to add the setting to the person's own start file (keeping a .bak).
 * It downloads nothing, sends nothing, and needs no admin rights. ComfyUI Desktop and Stability Matrix keep their own
 * settings: for those it says where the setting is instead. Windows line endings.
 */
export function startFile(port: number, origin: string): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("That isn't a port");
  const flag = corsFlag(origin);
  const lines = [
    "@echo off",
    "rem Start ComfyUI for Fuobe",
    `rem Restarts the ComfyUI on port ${port} with one more setting, so ${origin} can use it from your browser:`,
    `rem   ${flag}`,
    "rem It asks before it stops anything, keeps your other settings, downloads nothing and sends nothing.",
    "rem To undo it, start ComfyUI the usual way.",
    'set "FUOBE_BAT=%~f0"',
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=[IO.File]::ReadAllText($env:FUOBE_BAT); iex $s.Substring($s.IndexOf('#FUOBE'+'-PS'))"`,
    "echo.",
    "pause",
    "exit /b",
    "#FUOBE-PS",
    `$Port = ${port}`,
    `$Flag = ${ps(flag)}`,
    "$conn = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1",
    'if (-not $conn) { Write-Host "Nothing is running on port $Port. Start ComfyUI the usual way, then open this file again."; return }',
    '$proc = Get-CimInstance Win32_Process -Filter "ProcessId = $($conn.OwningProcess)"',
    '$parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($proc.ParentProcessId)" -ErrorAction SilentlyContinue',
    "if ($proc.Name -match '^ComfyUI' -or $parent.Name -match '^ComfyUI') {",
    `  Write-Host "This is ComfyUI Desktop. Open its Settings, then Server-Config, and paste ${origin} into Enable CORS header. Restart when it asks."; return }`,
    "if ($parent.Name -match '^StabilityMatrix') {",
    '  Write-Host "This ComfyUI runs from Stability Matrix. Open ComfyUI\'s Launch Options there, add this to Extra Launch Arguments, then stop and launch it:"; Write-Host "  $Flag"; return }',
    "$cmd = $proc.CommandLine",
    "if ($cmd -notmatch 'main\\.py') { Write-Host \"The program on port $Port isn't ComfyUI started from main.py, so this file leaves it alone.\"; return }",
    "$exe = $proc.ExecutablePath",
    "$dir = Split-Path (Split-Path $exe)",
    "if ($exe -match '\\\\Scripts\\\\python(w)?\\.exe$') { $dir = Split-Path $dir }",
    "if (-not (Test-Path (Join-Path $dir 'ComfyUI\\main.py')) -and -not (Test-Path (Join-Path $dir 'main.py'))) {",
    "  if ($cmd -match '\"?([A-Za-z]:\\\\[^\"]*?main\\.py)') { $dir = Split-Path $Matches[1] } else { Write-Host \"Couldn't tell which folder ComfyUI runs from. Add this to the end of the line that starts it in your start file, then start it again:\"; Write-Host \"  $Flag\"; return } }",
    "$args0 = if ($cmd.StartsWith('\"')) { $cmd.Substring($cmd.IndexOf('\"', 1) + 1) } else { $cmd.Substring(($cmd + ' ').IndexOf(' ')) }",
    "$args0 = ($args0 -replace '\\s--enable-cors-header(\\s+(\"[^\"]*\"|[^\\s-]\\S*))?', '').Trim()",
    '$line = "`"$exe`" $args0 $Flag"',
    'Write-Host "ComfyUI is running on port $Port from $dir."',
    "$yes = Read-Host 'Restart it now so Fuobe can use it? Anything it is making right now stops. [Y/N]'",
    "if ($yes -notmatch '^[Yy]') { Write-Host 'Nothing was changed.'; return }",
    "$bat = if ($parent.Name -eq 'cmd.exe' -and $parent.CommandLine -match '([^\"]+\\.bat)') { $Matches[1].Trim() } else { $null }",
    "if ($bat -and -not [IO.Path]::IsPathRooted($bat)) { $bat = Join-Path $dir $bat }",
    "if ($parent.Name -eq 'cmd.exe' -and $bat) { Stop-Process -Id $parent.ProcessId -Force -ErrorAction SilentlyContinue }",
    "Stop-Process -Id $proc.ProcessId -Force",
    "for ($i = 0; $i -lt 40 -and (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 250 }",
    `$mine = Join-Path $dir ${ps(START_FILE_NAME)}`,
    "Set-Content -Path $mine -Encoding OEM -Value @('@echo off', \"cd /d `\"$dir`\"\", \"title ComfyUI for Fuobe\", $line, 'pause')",
    "Start-Process -FilePath $mine -WorkingDirectory $dir",
    'Write-Host "Started ComfyUI again with Fuobe\'s setting. Fuobe connects by itself when it is ready."',
    'Write-Host "Next time, start it with: $mine"',
    "if ($bat -and (Test-Path $bat) -and ([IO.Path]::GetFileName($bat) -ne " + ps(START_FILE_NAME) + ")) {",
    "  $text = Get-Content -Raw $bat; $runs = @(Select-String -Path $bat -Pattern 'main\\.py')",
    "  if ($runs.Count -eq 1 -and $text -notmatch [regex]::Escape($Flag)) {",
    "    $add = Read-Host \"Also add this setting to $([IO.Path]::GetFileName($bat)), so it's always on? [Y/N]\"",
    "    if ($add -match '^[Yy]') {",
    "      Copy-Item $bat \"$bat.bak\" -Force",
    // Code page 437 maps every byte to a character and back: the rest of their file stays byte for byte.
    "      $enc = [Text.Encoding]::GetEncoding(437); $all = [IO.File]::ReadAllLines($bat, $enc); $n = $runs[0].LineNumber - 1",
    "      $all[$n] = ($all[$n] -replace '\\s--enable-cors-header(\\s+(\"[^\"]*\"|[^\\s-]\\S*))?', '') + ' ' + $Flag",
    "      [IO.File]::WriteAllLines($bat, $all, $enc)",
    '      Write-Host "Added it. The old file is kept as $bat.bak." } } }',
  ];
  return lines.join("\r\n") + "\r\n";
}
