import { z } from "zod";

export const AssistMessage = z.object({
  text: z.string().trim().min(1).max(8000),
  attachments: z.array(z.string().startsWith("/api/files/")).max(8).optional(),
});
