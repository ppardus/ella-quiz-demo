import { GenerateInput, generateWithLLM } from "../lib/llm.js";
export async function generateQuizzesWithLLM(input: GenerateInput) {
  return generateWithLLM(input);
}
