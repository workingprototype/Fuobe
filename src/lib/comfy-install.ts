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
