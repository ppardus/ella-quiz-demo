import axios from "axios";
const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE, headers: { "Content-Type": "application/json" } });

export type GeneratePayload = {
  target_language: string; known_language: string; level: string;
  words: { term: string; translation?: string }[];
  options?: { num_options?: number; shuffle?: boolean; llm_model?: string; seed?: number };
  metadata?: Record<string, any>;
};

export async function generateQuizzes(payload: GeneratePayload) {
  const { data } = await api.post("/api/quizzes/generate", payload);
  return data as any;
}
export async function getQuiz(quizId: string) {
  const { data } = await api.get(`/api/quizzes/${quizId}`); return data as any;
}
export async function listQuizzes(setId: string) {
  const { data } = await api.get(`/api/quiz-sets/${setId}/quizzes`); return data as any;
}
export async function submitAnswer(quizId: string, body: { choice_index?: number; time_ms?: number; action: "answered"|"skipped" }) {
  const { data } = await api.post(`/api/quizzes/${quizId}/answer`, body); return data as any;
}
export async function getSummary(setId: string) {
  const { data } = await api.get(`/api/quiz-sets/${setId}/summary`); return data as any;
}
