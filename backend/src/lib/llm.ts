import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

type QuizItem = {
  word: string;
  sentenceTarget: string;
  sentenceKnownMasked: string;
  optionsKnown: string[];
  correctIndex: number;
};

export type GenerateInput = {
  targetLanguage: string;
  knownLanguage: string;
  level: string;
  words: { term: string; translation?: string }[];
  numOptions: number;
  model?: string;
  seed?: number;
  shuffle?: boolean; // <-- NEW
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
  // Post-process to harden + randomize options
  return finalize(raw, input.numOptions, input.shuffle !== false, input.seed);
}

async function generateOpenAI(input: GenerateInput): Promise<QuizItem[]> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

  const sys = `You are a precise ${input.targetLanguage} vocabulary quiz generator for ${input.level} learners.`;

  const wordsList = input.words
    .map((w, i) => `${i + 1}. ${w.term}${w.translation ? ` — ${w.translation}` : ""}`)
    .join("\n");

  const user = `
Generate ${input.words.length} multiple-choice quizzes.

Input words:
${wordsList}

For each word, return strict JSON with:
- sentence_target: ${input.targetLanguage} sentence containing the target word
- sentence_known_masked: same sentence in ${input.knownLanguage}, the target word replaced by "_____"
- options_known: ${input.numOptions} options in ${input.knownLanguage}
  • exactly 1 correct translation of the target word
  • ${input.numOptions - 1} plausible distractors of the SAME part of speech
  • distractors should be semantically CLOSE and confusable in context, but WRONG
  • avoid obvious cognates, length cues, or category outliers
- correct_index: 0-based index of the correct option

Style constraints:
- Only vocab/grammar at or below ${input.level}.
- Sentences short, natural, grammatical.
- Do NOT reveal the translation in the sentence.
- Vary the position of the correct option across questions (not always first).

Return ONLY JSON in this shape:
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

Words:
${input.words.map((w, i) => `${i + 1}. ${w.term}${w.translation ? ` — ${w.translation}` : ""}`).join("\n")}

Return ONLY strict JSON:
{"items":[
  {"word":"...","sentence_target":"...","sentence_known_masked":"...","options_known":["a","b","c","d"],"correct_index":0}
]}

Guidelines:
- ${input.numOptions} options: 1 correct translation + ${input.numOptions - 1} distractors.
- Distractors: same POS, semantically close, plausible in context, but incorrect.
- Avoid transparent cognates, length or morphological cues.
- Vary the position of the correct option across questions.
- Keep sentences short, natural, grammatical. Do not leak the translation in the sentence.
`;

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
  if (newCorrect < 0) newCorrect = 0; // ultimate fallback

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
  // deterministic per-item offset
  const base = seed ?? Date.now();
  return (base ^ ((idx + 1) * 0x9e3779b1)) >>> 0;
}
