/**
 * Which open models run each ComfyUI workflow, for the Workflows page ("used by …"). Pure, so the
 * page computes routes on the server and the view only indexes them.
 */

import { OPERATION_OUTPUT, type MediaKind, type Operation } from "./catalog/types";

/** The filter chips on the Workflows page: what a workflow makes. */
export const WORKFLOW_GROUPS = ["Image", "Video", "Audio", "Text & 3D"] as const;
export type WorkflowGroup = (typeof WORKFLOW_GROUPS)[number];

const GROUP_OF: Record<MediaKind, WorkflowGroup> = { image: "Image", video: "Video", audio: "Audio", text: "Text & 3D", model3d: "Text & 3D" };

/** Which group a workflow's capability belongs to (its operation's output; a few capabilities aren't operations). */
export function capabilityGroup(capability: string): WorkflowGroup {
  const kind = OPERATION_OUTPUT[capability as Operation] as MediaKind | undefined;
  if (kind) return GROUP_OF[kind];
  if (/video|motion|vfx/.test(capability)) return "Video";
  if (/audio|voice|music|speech|sound/.test(capability)) return "Audio";
  if (/3d|text|transcri|caption/.test(capability)) return "Text & 3D";
  return "Image";
}

/** An open model's ComfyUI route, from the catalog on the server ("video-concat-{n}" style endpoints match by pattern). */
export interface ComfyRoute {
  endpoint: string;
  name: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");

/**
 * Index routes by workflow id. Endpoints with `{n}` (one workflow per clip count, e.g.
 * "video-concat-{n}") match any number in its place. Names are deduplicated, in route order.
 */
export function usedByIndex(routes: ComfyRoute[]): (workflowId: string) => string[] {
  const exact = new Map<string, string[]>();
  const patterns: { re: RegExp; name: string }[] = [];
  for (const r of routes) {
    if (r.endpoint.includes("{n}")) patterns.push({ re: new RegExp(`^${r.endpoint.split("{n}").map(escapeRe).join("\\d+")}$`), name: r.name });
    else exact.set(r.endpoint, [...(exact.get(r.endpoint) ?? []), r.name]);
  }
  return (id) => [...new Set([...(exact.get(id) ?? []), ...patterns.filter((p) => p.re.test(id)).map((p) => p.name)])];
}
