import { z } from "zod";

export const GenerateBody = z.object({
  target_language: z.string().min(1),
  known_language: z.string().min(1),
  level: z.string().min(1),
  words: z.array(z.object({ term: z.string().min(1), translation: z.string().optional() })).min(1),
  options: z.object({
    num_options: z.number().int().min(4).max(6).default(4),
    shuffle: z.boolean().default(true),
    llm_model: z.string().optional(),
    seed: z.number().optional()
  }).default({}),
  metadata: z.record(z.any()).optional()
});
