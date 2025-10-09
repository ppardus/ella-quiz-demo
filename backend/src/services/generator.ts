import { GenerateInput, generateWithLLM } from "../lib/llm";
export async function generateQuizzesWithLLM(input: GenerateInput) {
  return generateWithLLM(input);
}
