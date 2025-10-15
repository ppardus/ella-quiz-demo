import axios from "axios";

// If you set VITE_API_BASE (e.g., http://localhost:3000) we'll use it.
// Otherwise keep it empty "" and configure a Vite proxy for /api in vite.config.ts.
export const API_BASE = (import.meta.env.VITE_API_BASE?.trim?.() ?? "") || "";

const api = axios.create({
  baseURL: API_BASE,
  headers: { "Content-Type": "application/json" },
  withCredentials: false,
});

// Log server errors to the console so it's obvious what's going wrong
api.interceptors.response.use(
  (r) => r,
  (err) => {
    const url = err?.config?.url || "(unknown url)";
    const method = err?.config?.method || "GET";
    const status = err?.response?.status;
    const body = err?.response?.data;
    console.error(`[API ERROR] ${method?.toUpperCase()} ${url} -> ${status || ""}`, body || err.message);
    return Promise.reject(err);
  }
);

export type GeneratePayload = {
  target_language: string;
  known_language: string;
  level: string;
  words?: { term: string; translation?: string }[];
  options?: { num_options?: number; shuffle?: boolean; llm_model?: string; seed?: number };
  metadata?: Record<string, any>;
  raw_text?: string;
};

export async function generateQuizzes(payload: GeneratePayload) {
  const { data } = await api.post("/api/quizzes/generate", payload);
  return data as any;
}

export async function getQuiz(quizId: string) {
  const { data } = await api.get(`/api/quizzes/${quizId}`);
  return data as any;
}

export async function listQuizzes(setId: string) {
  const { data } = await api.get(`/api/quiz-sets/${setId}/quizzes`);
  return data as any;
}

/** Attempt-aware routes **/

export async function nextUnanswered(setId: string, attempt: string) {
  const { data } = await api.get(`/api/quiz-sets/${setId}/next`, {
    params: { attempt },
  });
  return data as any; // {status, total, question?}
}

export async function continueAttempt(setId: string, attempt: string) {
  const { data } = await api.get(`/api/quiz-sets/${setId}/continue`, {
    params: { attempt },
  });
  return data as any; // {status, next_quiz_id?, index?}
}

export async function answerQuiz(
  quizId: string,
  body: { choice_index?: number; time_ms?: number; action: "answered" | "skipped"; attempt: string }
) {
  const { data } = await api.post(`/api/quizzes/${quizId}/answer`, body);
  return data as any; // { correct, correct_index, already_recorded? }
}

export async function getSummary(setId: string, attempt?: string) {
  const { data } = await api.get(`/api/quiz-sets/${setId}/summary`, {
    params: attempt ? { attempt } : {},
  });
  return data as any;
}
