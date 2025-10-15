import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

type QuizItem = {
  word: string;
  sentenceTarget: string;
  sentenceKnownMasked: string;
  optionsKnown: string[];
  correctIndex: number;
  difficultyScore?: number;
  difficultyLabel?: "Easy" | "Moderate" | "Hard";
  difficultyReason?: string;
};

export type GenerateInput = {
  targetLanguage: string;
  knownLanguage: string;
  level: string;
  words: { term: string; translation?: string }[];
  numOptions: number;
  model?: string;
  seed?: number;
  shuffle?: boolean; // optional, default true
};

const provider = (process.env.PREFERRED_LLM || "openai").toLowerCase();

export async function generateWithLLM(input: GenerateInput): Promise<QuizItem[]> {
  if (provider === "openai" && !process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY in environment");
  }
  if (provider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    throw new Error("Missing ANTHROPIC_API_KEY in environment");
  }

  const raw = provider === "anthropic" ? await generateAnthropic(input) : await generateOpenAI(input);
  const finalized = finalize(raw, input.numOptions, input.shuffle !== false, input.seed);

  try {
    const diffs = await evaluateDifficultyOpenAI(finalized, input);
    for (let i = 0; i < finalized.length; i++) {
      Object.assign(finalized[i], diffs[i]);
    }
  } catch (e) {
    // If evaluator fails, proceed without difficulty
    console.warn("Difficulty evaluation failed:", (e as any)?.message);
  }
  return finalized;
}

async function generateOpenAI(input: GenerateInput): Promise<QuizItem[]> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

  const sys = `You are a precise ${input.targetLanguage} vocabulary quiz generator for ${input.level} learners. Return JSON only.`;

  const wordsList = input.words
    .map((w, i) => `${i + 1}. ${w.term}${w.translation ? ` — ${w.translation}` : ""}`)
    .join("\n");

  const user = `
You are a precise ${input.targetLanguage} vocabulary quiz generator for ${input.level} learners.

Task:
Generate multiple-choice vocabulary quizzes.

Input:
A list of ${input.targetLanguage} words with their ${input.knownLanguage} translations (optional).

Output (for each word):
- A short, natural ${input.targetLanguage} sentence containing the target word.
- The same sentence translated into ${input.knownLanguage}, with the target word replaced by "_____".
- ${input.numOptions} answer options in ${input.knownLanguage}: one correct translation and ${input.numOptions - 1} distractors.
- All options must fit grammatically and semantically in the translated sentence.
- Only the correct answer must preserve the full meaning of the ${input.targetLanguage} sentence.

Guidelines:
- Use vocabulary and grammar at or below ${input.level}.
- Sentences must be natural, concise, and grammatically correct.
- The ${input.knownLanguage} translation must be accurate and faithful to the ${input.targetLanguage} sentence except for "_____".
- Distractors must share the same part of speech, gender, number, and case as the correct answer.
- The placeholder "_____" must always be present in the ${input.knownLanguage} translation.

Validation Rules:
Grammatical Validation:
- Replace each option in the ${input.targetLanguage} sentence; all options must remain grammatically correct.
Semantic Validation:
- Replace each option in the translation; all must be coherent in context, but only the correct option exactly matches the intended meaning of the original sentence.

Generate quizzes for these words:
${wordsList}

Return ONLY strict JSON in this exact shape:
{"items":[
  {"word":"...","sentence_target":"...","sentence_known_masked":"...","options_known":["a","b","c","d"],"correct_index":0}
]}`;

  const resp = await client.chat.completions.create({
    model: input.model || "gpt-4o-mini",
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [{ role: "system", content: sys }, { role: "user", content: user }]
  });

  const json = JSON.parse(resp.choices[0]?.message?.content || "{}");
  return (json.items ?? []).map((it: any) => ({
    word: it.word,
    sentenceTarget: it.sentence_target,
    sentenceKnownMasked: it.sentence_known_masked,
    optionsKnown: it.options_known,
    correctIndex: it.correct_index
  }));
}

async function generateAnthropic(input: GenerateInput): Promise<QuizItem[]> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const prompt = `
You are a precise ${input.targetLanguage} vocabulary quiz generator for ${input.level} learners.

Task:
Generate multiple-choice vocabulary quizzes.

Input:
A list of ${input.targetLanguage} words with their ${input.knownLanguage} translations (optional).

Output (for each word):
- A short, natural ${input.targetLanguage} sentence containing the target word.
- The same sentence translated into ${input.knownLanguage}, with the target word replaced by "_____".
- ${input.numOptions} answer options in ${input.knownLanguage}: one correct translation and ${input.numOptions - 1} distractors.
- All options must fit grammatically and semantically in the translated sentence.
- Only the correct answer must preserve the full meaning of the ${input.targetLanguage} sentence.

Guidelines:
- Use vocabulary and grammar at or below ${input.level}.
- Sentences must be natural, concise, and grammatically correct.
- The ${input.knownLanguage} translation must be accurate and faithful to the ${input.targetLanguage} sentence except for "_____".
- Distractors must share the same part of speech, gender, number, and case as the correct answer.
- The placeholder "_____" must always be present in the ${input.knownLanguage} translation.

Validation Rules:
- Grammatical & Semantic validations as above.

Words:
${input.words.map((w, i) => `${i + 1}. ${w.term}${w.translation ? ` — ${w.translation}` : ""}`).join("\n")}

Return ONLY strict JSON in this exact shape:
{"items":[
  {"word":"...","sentence_target":"...","sentence_known_masked":"...","options_known":["a","b","c","d"],"correct_index":0}
]}`;

  const msg = await client.messages.create({
    model: input.model || "claude-3-haiku-20240307",
    temperature: 0.3,
    max_tokens: 1200,
    system: "Return valid JSON only, no prose.",
    messages: [{ role: "user", content: prompt }]
  });

  const text = (msg.content?.[0] as any)?.text || "{}";
  const json = JSON.parse(text);
  return (json.items ?? []).map((it: any) => ({
    word: it.word,
    sentenceTarget: it.sentence_target,
    sentenceKnownMasked: it.sentence_known_masked,
    optionsKnown: it.options_known,
    correctIndex: it.correct_index
  }));
}

/** -------- Finalization: dedupe, ensure correct present, pad, shuffle (seeded), fix index -------- */

function finalize(items: QuizItem[], n: number, doShuffle: boolean, seed?: number): QuizItem[] {
  return items.map((it, idx) => normalizeOne(it, n, doShuffle, mixSeed(seed, idx)));
}

function normalizeOne(it: QuizItem, n: number, doShuffle: boolean, seed?: number): QuizItem {
  const original = Array.isArray(it.optionsKnown) ? it.optionsKnown.slice() : [];
  const fallbackCorrect = clampIndex(it.correctIndex, original.length);
  const correctValue = String(original[fallbackCorrect] ?? original[0] ?? "").trim();

  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const s of original) {
    const v = (s ?? "").toString().trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    cleaned.push(v);
  }

  if (correctValue && !cleaned.includes(correctValue)) cleaned.unshift(correctValue);

  while (cleaned.length < n) cleaned.push("—");
  let options = cleaned.slice(0, n);

  if (doShuffle) {
    const rnd = seeded(seed);
    options = shuffle(options, rnd);
  }

  let newCorrect = options.indexOf(correctValue);
  if (newCorrect < 0) newCorrect = 0;

  return {
    word: String(it.word || "").trim(),
    sentenceTarget: String(it.sentenceTarget || "").trim(),
    sentenceKnownMasked: String(it.sentenceKnownMasked || "").trim(),
    optionsKnown: options,
    correctIndex: newCorrect
  };
}

/** Utilities */

function clampIndex(i: any, len: number) {
  const ii = Number.isInteger(i) ? Number(i) : 0;
  if (len <= 0) return 0;
  return Math.max(0, Math.min(ii, len - 1));
}

function seeded(seed?: number) {
  // mulberry32
  let a = (seed ?? Date.now()) >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function mixSeed(seed: number | undefined, idx: number): number {
  const base = seed ?? Date.now();
  return (base ^ ((idx + 1) * 0x9e3779b1)) >>> 0;
}

type DiffPatch = Partial<Pick<QuizItem, "difficultyScore" | "difficultyLabel" | "difficultyReason">>;

async function evaluateDifficultyOpenAI(items: QuizItem[], input: GenerateInput): Promise<DiffPatch[]> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  const sys = "You are an educational content evaluator. Return valid JSON only.";

  const payload = {
    target_language: input.targetLanguage,
    known_language: input.knownLanguage,
    level: input.level,
    quizzes: items.map((q, i) => ({
      index: i + 1,
      sentence_target: q.sentenceTarget,
      options_known: q.optionsKnown,
      correct_index: q.correctIndex,
    })),
    rubric: {
      context_clarity: "0-3",
      word_familiarity: "0-2",
      distractor_quality: "0-3",
      grammar_clue: "0-1",
      cognate_similarity: "0-1",
      total: "0-10",
      labels: { easy: "8-10", moderate: "5-7", hard: "0-4" },
    },
  };

  const user = `
Task: For each quiz, assign difficulty_score (0..10) and difficulty_label (Easy|Moderate|Hard) using:
8–10 → Easy, 5–7 → Moderate, 0–4 → Hard.
Also include a short "reason" string.

Return ONLY strict JSON:
{"items":[{"index":1,"score":8,"label":"Easy","reason":"..."}]}

Input JSON:
${JSON.stringify(payload)}
`;

  const resp = await client.chat.completions.create({
    model: input.model || "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [{ role: "system", content: sys }, { role: "user", content: user }],
  });

  const json = JSON.parse(resp.choices[0]?.message?.content || "{}");
  const byIndex: Record<number, { score?: number; label?: "Easy" | "Moderate" | "Hard"; reason?: string }> = {};

  for (const it of json.items ?? []) {
    const idx = Number(it.index);
    if (!Number.isFinite(idx)) continue;
    const scoreNum = Number(it.score);
    byIndex[idx] = {
      score: Number.isFinite(scoreNum) ? scoreNum : undefined,
      label: asDifficultyLabel(it.label),
      reason: typeof it.reason === "string" ? it.reason : undefined,
    };
  }

  return items.map((_, i) => {
    const v = byIndex[i + 1];
    if (!v) return {};
    const patch: DiffPatch = {};
    if (typeof v.score === "number") patch.difficultyScore = v.score;
    if (v.label) patch.difficultyLabel = v.label; // <- narrowed union type
    if (v.reason) patch.difficultyReason = v.reason;
    return patch;
  });
}


function asDifficultyLabel(x: any): "Easy" | "Moderate" | "Hard" | undefined {
  const v = String(x ?? "");
  return v === "Easy" || v === "Moderate" || v === "Hard" ? v : undefined;
}