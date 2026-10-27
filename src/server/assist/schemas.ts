import { z } from "zod";
import { ASSIST_EFFORTS, ASSIST_MODES, MEMORY_CATEGORIES, PROJECT_COLORS } from "@/lib/assist";
import { MAX_SCHEDULE_CAP_USD, MAX_SCHEDULE_HOURS, MAX_SCHEDULE_PROMPT } from "@/lib/assist-schedule";

export const AssistMessage = z.object({
  text: z.string().trim().min(1).max(8000),
  attachments: z.array(z.string().startsWith("/api/files/")).max(8).optional(),
});

export const ModeChoice = z.object({
  mode: z.enum(ASSIST_MODES.map((m) => m.id) as ["free", "smart", "manual"]),
  agent: z.enum(["claude", "ollama", "offline"]).optional(),
  model: z.string().max(100).nullish(),
  effort: z.enum(ASSIST_EFFORTS.map((e) => e.id) as ["low", "medium", "high", "xhigh", "max"]).nullish(),
});

export const SkillBody = z.object({
  name: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(1024),
  whenToUse: z.string().trim().max(1024).optional(),
  body: z.string().min(1).max(60_000),
  icon: z.string().max(40).optional(),
});

export const MemoryCategorySchema = z.enum(MEMORY_CATEGORIES);

export const ProjectBody = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  color: z.enum(PROJECT_COLORS).optional(),
  instructions: z.string().max(8000).optional(),
  skills: z.array(z.string().max(64)).max(30).optional(),
  usePersonalMemory: z.boolean().optional(),
});

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a time");

export const ScheduleRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("daily"), time: Time }),
  z.object({ kind: z.literal("weekly"), days: z.array(z.number().int().min(0).max(6)).min(1).max(7), time: Time }),
  z.object({ kind: z.literal("hours"), every: z.number().int().min(1).max(MAX_SCHEDULE_HOURS) }),
  z.object({ kind: z.literal("once"), at: z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, "Pick a date and time") }),
]);

/** A scheduled task as the dialog sends it (create: everything; edit: any part). */
export const ScheduleBody = z.object({
  title: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(MAX_SCHEDULE_PROMPT),
  attachments: z.array(z.string().startsWith("/api/files/")).max(8).optional(),
  projectId: z.string().max(40).nullish(),
  rule: ScheduleRuleSchema,
  tz: z.string().min(1).max(64),
  approval: z.enum(["ask", "auto"]),
  capUsd: z.number().min(0).max(MAX_SCHEDULE_CAP_USD).nullish(),
  engine: z.enum(["cloud", "open"]),
  mode: ModeChoice.nullish(),
  paused: z.boolean().optional(),
});

export const ConnectorBody = z.object({
  name: z.string().max(200).optional(),
  url: z.string().max(4096).optional(),
  token: z.string().max(8192).optional(),
  enabled: z.boolean().optional(),
});
