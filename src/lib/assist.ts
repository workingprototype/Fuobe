/**
 * Assist: a chat agent that plans a shoot, picks models, shows the cost, asks before spending
 * and then runs the generations (Higgsfield's "Supercomputer"). Shared by the server loop and the UI.
 */
import type { Engine, Generation, MediaKind, Operation } from "./catalog/types";

/** One job the agent wants to run, priced before the user approves it. */
export interface PlannedJob {
  tool: "generate" | "create_storyboard";
  modelId: string;
  modelName: string;
  kind: MediaKind;
  op: Operation | "storyboard";
  prompt: string;
  /** Generations this job creates (outputs × jobs, or storyboard frames). */
  count: number;
  costUsd: number | null;
  /** No provider connected: it would run as a demo. */
  demo: boolean;
  /** Can't run as planned (missing input, model blocked by engine mode…). */
  error?: string;
}

export type AssistItem =
  | { id: string; role: "user"; text: string; attachments?: string[] }
  | { id: string; role: "assistant"; text: string }
  | { id: string; role: "tool"; text: string }
  | { id: string; role: "approval"; summary: string; jobs: PlannedJob[]; totalUsd: number | null; status: "pending" | "approved" | "declined" }
  | { id: string; role: "generations"; ids: string[]; storyboard?: boolean }
  | { id: string; role: "notice"; text: string; tone: "info" | "error" };

export type AssistStatus = "idle" | "running" | "waiting";

export interface AssistThread {
  id: string;
  title: string;
  status: AssistStatus;
  /** "claude" = the full agent; "offline" = a rule-based planner (no LLM configured). */
  agent: "claude" | "offline";
  engine: Engine;
  /** Run plans without the approval card. */
  autoApprove: boolean;
  items: AssistItem[];
  createdAt: number;
  updatedAt: number;
}

export interface AssistThreadSummary {
  id: string;
  title: string;
  status: AssistStatus;
  updatedAt: number;
}

export interface AssistThreadView {
  thread: AssistThread;
  /** Generations referenced by the thread's cards. */
  generations: Generation[];
}

export const totalCost = (jobs: PlannedJob[]): number | null =>
  jobs.some((j) => j.costUsd === null && !j.demo) ? null : Math.round(jobs.reduce((s, j) => s + (j.costUsd ?? 0), 0) * 1000) / 1000;

export function threadTitle(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 60 ? `${t.slice(0, 57).replace(/\s+\S*$/, "")}…` : t || "New chat";
}
