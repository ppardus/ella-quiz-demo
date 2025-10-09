import { z } from "zod";

export const GenerateBody = z
  .object({
    target_language: z.string().min(1),
    known_language: z.string().min(1),
    level: z.string().min(1),
    // EITHER words[] OR raw_text
    words: z
      .array(
        z.object({
          term: z.string().min(1),
          translation: z.string().optional(),
        })
      )
      .optional(),
    raw_text: z.string().optional(),
    options: z
      .object({
        num_options: z.number().int().min(4).max(6).default(4),
        shuffle: z.boolean().default(true),
        llm_model: z.string().optional(),
        seed: z.number().optional(),
      })
      .default({}),
    metadata: z.record(z.any()).optional(),
  })
  .refine(
    (v) =>
      (v.words && v.words.length > 0) ||
      (v.raw_text && v.raw_text.trim().length > 0),
    { message: "Provide either words[] or raw_text" }
  );
