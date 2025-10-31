import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

export type DifficultyLabel = "Easy" | "Moderate" | "Hard";

type QuizItem = {
  word: string;
  sentenceTarget: string;
  sentenceKnownMasked: string;
  optionsKnown: string[];
  correctIndex: number;
  difficultyScore?: number;
  difficultyLabel?: DifficultyLabel;
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
  shuffle?: boolean; // default true
};

const provider = (process.env.PREFERRED_LLM || "openai").toLowerCase();

/** Entry point */
export async function generateWithLLM(input: GenerateInput): Promise<QuizItem[]> {
  if (provider === "openai" && !process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY in environment");
  }
  if (provider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    throw new Error("Missing ANTHROPIC_API_KEY in environment");
  }

  const raw =
    provider === "anthropic" ? await generateAnthropic(input) : await generateOpenAI(input);

  // sanitize options & enforce highlight tag before finalizing
  const sanitized = raw.map(enforceHighlightAndSanitize);

  const finalized = finalize(sanitized, input.numOptions, input.shuffle !== false, input.seed);

  try {
    const diffs = await evaluateDifficultyOpenAI(finalized, input);
    for (let i = 0; i < finalized.length; i++) Object.assign(finalized[i], diffs[i]);
  } catch (e) {
    console.warn("Difficulty evaluation failed:", (e as any)?.message);
  }

  return finalized;
}

/* ------------------------- Generation: OpenAI -------------------------- */

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

Output (for each word) — JSON fields:
- sentence_target: a short, natural ${input.targetLanguage} sentence that **contains the target word wrapped in <tgt>…</tgt>**. Example: "Ich habe gestern eine <tgt>Entscheidung</tgt> getroffen."
- sentence_known_masked: the same sentence translated into ${input.knownLanguage}, with **only the target word replaced** by "_____". Keep any required article, preposition, auxiliary, or classifier **outside** the blank.
- options_known: ${input.numOptions} options in ${input.knownLanguage}: 1 correct translation + ${
    input.numOptions - 1
  } distractors. **Do not prefix options with labels** like "a)", "b)". Provide plain strings only.
- correct_index: 0-based index of the correct option.

Constraints:
- Use vocabulary/grammar at or below ${input.level}.
- The ${input.knownLanguage} translation must fully preserve the meaning of the ${input.targetLanguage} sentence; only the target word is blanked.
- Distractors share the same part of speech, gender, number, and case as the correct answer.
- The placeholder "_____" must always be present in the ${input.knownLanguage} translation.
- Vary the position of the correct option (not always first).

Validation:
- Grammatical: replacing any option in ${input.targetLanguage} keeps the sentence grammatical.
- Semantic: only the correct option exactly matches the intended meaning.

Return ONLY strict JSON in this exact shape:
{"items":[
  {"word":"...","sentence_target":"...","sentence_known_masked":"...","options_known":["opt1","opt2","opt3","opt4"],"correct_index":0}
]}

Generate quizzes for these words:
${wordsList}
`;

  const resp = await client.chat.completions.create({
    model: input.model || "gpt-4o-mini",
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
  });

  const json = JSON.parse(resp.choices[0]?.message?.content || "{}");
  const items = Array.isArray(json.items) ? json.items : [];
  return items.map((it: any) => ({
    word: String(it.word ?? ""),
    sentenceTarget: String(it.sentence_target ?? ""),
    sentenceKnownMasked: String(it.sentence_known_masked ?? ""),
    optionsKnown: Array.isArray(it.options_known) ? it.options_known.map((x: any) => String(x ?? "")) : [],
    correctIndex: Number.isInteger(it.correct_index) ? it.correct_index : 0,
  }));
}

/* ----------------------- Generation: Anthropic ------------------------- */

async function generateAnthropic(input: GenerateInput): Promise<QuizItem[]> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const prompt = `
You are a precise ${input.targetLanguage} vocabulary quiz generator for ${input.level} learners.

Task:
Generate multiple-choice vocabulary quizzes.

Input:
A list of ${input.targetLanguage} words with their ${input.knownLanguage} translations (optional).

Output (for each word) — JSON fields:
- sentence_target: a short, natural ${input.targetLanguage} sentence that **contains the target word wrapped in <tgt>…</tgt>**.
- sentence_known_masked: the same sentence translated into ${input.knownLanguage}, with **only the target word replaced** by "_____". Keep any required article, preposition, auxiliary, or classifier **outside** the blank.
- options_known: ${input.numOptions} options in ${input.knownLanguage}: 1 correct + ${
    input.numOptions - 1
  } distractors. **Do not prefix options with labels** (no "a)", "b)", etc). Plain strings only.
- correct_index: 0-based index of correct option.

Constraints:
- Use vocabulary/grammar at or below ${input.level}.
- Translation must fully preserve the meaning of the original; only the target word is blanked.
- Distractors share POS/gender/number/case with the correct one.
- "_____" must be present in the ${input.knownLanguage} translation.
- Vary the position of the correct option.

Validation rules as above.

Return ONLY strict JSON in this exact shape:
{"items":[
  {"word":"...","sentence_target":"...","sentence_known_masked":"...","options_known":["opt1","opt2","opt3","opt4"],"correct_index":0}
]}

Words:
${input.words.map((w, i) => `${i + 1}. ${w.term}${w.translation ? ` — ${w.translation}` : ""}`).join("\n")}
`;

  const msg = await client.messages.create({
    model: input.model || "claude-3-haiku-20240307",
    temperature: 0.3,
    max_tokens: 1200,
    system: "Return valid JSON only, no prose.",
    messages: [{ role: "user", content: prompt }],
  });

  const text = (msg.content?.[0] as any)?.text || "{}";
  const json = JSON.parse(text);
  const items = Array.isArray(json.items) ? json.items : [];
  return items.map((it: any) => ({
    word: String(it.word ?? ""),
    sentenceTarget: String(it.sentence_target ?? ""),
    sentenceKnownMasked: String(it.sentence_known_masked ?? ""),
    optionsKnown: Array.isArray(it.options_known) ? it.options_known.map((x: any) => String(x ?? "")) : [],
    correctIndex: Number.isInteger(it.correct_index) ? it.correct_index : 0,
  }));
}

/* ---------------------- Post-process & Utilities ----------------------- */

/** Clean options & enforce <tgt>…</tgt> tag in sentenceTarget */
function enforceHighlightAndSanitize(it: QuizItem): QuizItem {
  // Strip any "a)"/"b)"/"c)"/"d)" prefixes the model might add
  const options = (it.optionsKnown || []).map(cleanOptionText);

  // Ensure sentenceTarget contains the highlight tag for the target word
  let sent = it.sentenceTarget || "";
  if (!/<tgt>.*<\/tgt>/.test(sent)) {
    const w = (it.word || "").trim();
    if (w) {
      const re = wordLikeRegex(w);
      sent = sent.replace(re, (m) => `<tgt>${m}</tgt>`);
    }
  }

  return {
    ...it,
    sentenceTarget: sent,
    optionsKnown: options,
  };
}

function cleanOptionText(s: string): string {
  let v = String(s || "");
  // remove one or multiple leading labels like "a) ", "b) ", "a) b) ", "A: ", etc.
  v = v.replace(/^\s*(?:[a-dA-D][\)\.\:\-]\s*)+/g, "");
  // also remove things like "a) b) c)" if present redundantly
  v = v.replace(/^\s*(?:[a-d]\)|[a-d]\.|[a-d]\:)\s*/i, "");
  return v.trim();
}

function wordLikeRegex(word: string): RegExp {
  // Escape regex metachars
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Use Unicode letters & marks, try to respect “word-ish” boundaries
  // We accept inflectional variants only if they include the base as a substring (still language-agnostic).
  // Prefer whole-word match first; if none, fallback to first occurrence.
  return new RegExp(`\\b${esc}\\b`, "iu");
}

function finalize(items: QuizItem[], n: number, doShuffle: boolean, seed?: number): QuizItem[] {
  return items.map((it, idx) => normalizeOne(it, n, doShuffle, mixSeed(seed, idx)));
}

function normalizeOne(it: QuizItem, n: number, doShuffle: boolean, seed?: number): QuizItem {
  const original = Array.isArray(it.optionsKnown) ? it.optionsKnown.slice() : [];
  const fallbackCorrect = clampIndex(it.correctIndex, original.length);
  const correctValue = String(original[fallbackCorrect] ?? original[0] ?? "").trim();

  // 1) Clean & dedupe while preserving order
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const s of original) {
    const v = (s ?? "").toString().trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    cleaned.push(v);
  }

  // 2) Ensure correct option is included
  if (correctValue && !cleaned.includes(correctValue)) cleaned.unshift(correctValue);

  // 3) Pad to N with placeholders if needed
  while (cleaned.length < n) cleaned.push("—");

  // 4) Cut to N
  let options = cleaned.slice(0, n);

  // 5) Shuffle (seeded) if requested
  if (doShuffle) {
    const rnd = seeded(seed);
    options = shuffle(options, rnd);
  }

  // 6) Recompute correctIndex
  let newCorrect = options.indexOf(correctValue);
  if (newCorrect < 0) newCorrect = 0;

  return {
    word: String(it.word || "").trim(),
    sentenceTarget: String(it.sentenceTarget || "").trim(),
    sentenceKnownMasked: String(it.sentenceKnownMasked || "").trim(),
    optionsKnown: options,
    correctIndex: newCorrect,
  };
}

function clampIndex(i: any, len: number) {
  const ii = Number.isInteger(i) ? Number(i) : 0;
  if (len <= 0) return 0;
  return Math.max(0, Math.min(ii, len - 1));
}

function seeded(seed?: number) {
  // mulberry32
  let a = (seed ?? Date.now()) >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
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

/* -------------------- Difficulty Evaluation (OpenAI) ------------------- */

type DiffPatch = Partial<
  Pick<QuizItem, "difficultyScore" | "difficultyLabel" | "difficultyReason">
>;

function asDifficultyLabel(x: any): DifficultyLabel | undefined {
  const v = String(x ?? "");
  return v === "Easy" || v === "Moderate" || v === "Hard" ? v : undefined;
}

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
Task: For each quiz, assign difficulty_score (0..10) and difficulty_label (Easy|Moderate|Hard):
8–10 → Easy, 5–7 → Moderate, 0–4 → Hard.
Also include a short "reason".

Return ONLY strict JSON:
{"items":[{"index":1,"score":8,"label":"Easy","reason":"..."}]}

Input JSON:
${JSON.stringify(payload)}
`;

  const resp = await client.chat.completions.create({
    model: input.model || "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
  });

  const json = JSON.parse(resp.choices[0]?.message?.content || "{}");
  const byIndex: Record<number, { score?: number; label?: DifficultyLabel; reason?: string }> = {};

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
    if (v.label) patch.difficultyLabel = v.label;
    if (v.reason) patch.difficultyReason = v.reason;
    return patch;
  });
}
