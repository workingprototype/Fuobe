/**
 * The commands Workflows → "Copy install commands" puts on the clipboard for one workflow: its custom node packs, then
 * the model files it still lacks. Pure (no I/O), so it can be tested and run in the browser.
 */
import type { ManifestModel, ManifestWorkflow } from "./comfy";

type Installable = Pick<ManifestWorkflow, "customNodes"> & { models: (ManifestModel & { present?: boolean | null })[] };

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
  const lines = wf.models
    .filter((m) => m.url && m.present !== true && !m.optional)
    .map((m) => {
      const sub = m.file.includes("/") ? `/${m.file.slice(0, m.file.lastIndexOf("/"))}` : "";
      return `mkdir -p "$COMFYUI/models/${m.folder}${sub}" && wget -c -O "$COMFYUI/models/${m.folder}/${m.file}" "${m.url}"`;
    });
  return ["COMFYUI=${COMFYUI:-$HOME/ComfyUI}", ...wf.customNodes.map(nodeInstall), ...lines].join("\n");
}
