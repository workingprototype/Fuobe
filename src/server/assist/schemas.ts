import { z } from "zod";
import { ASSIST_EFFORTS, ASSIST_MODES, MEMORY_CATEGORIES, normalizeAgent, PROJECT_COLORS } from "@/lib/assist";

export const AssistMessage = z.object({
  text: z.string().trim().min(1).max(8000),
  attachments: z.array(z.string().startsWith("/api/files/")).max(8).optional(),
});

export const ModeChoice = z.object({
  mode: z.enum(ASSIST_MODES.map((m) => m.id) as ["free", "smart", "manual"]),
  // "ollama": the local agent's old name, from browsers that saved a choice before.
  agent: z
    .enum(["claude", "local", "ollama", "offline"])
    .optional()
    .transform((a) => normalizeAgent(a)),
  // LM Studio ids can be long (publisher/model@quant).
  model: z.string().max(200).nullish(),
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
