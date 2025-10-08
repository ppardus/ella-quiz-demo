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
};

const provider = (process.env.PREFERRED_LLM || "openai").toLowerCase();

export async function generateWithLLM(input: GenerateInput): Promise<QuizItem[]> {
  if (provider === "openai" && !process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY in environment");
  }
  if (provider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    throw new Error("Missing ANTHROPIC_API_KEY in environment");
  }
  return provider === "anthropic" ? generateAnthropic(input) : generateOpenAI(input);
}

async function generateOpenAI(input: GenerateInput): Promise<QuizItem[]> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  const sys = `You are a precise ${input.targetLanguage} vocabulary quiz generator for ${input.level} learners.`;
  const wordsList = input.words.map((w,i)=>`${i+1}. ${w.term}${w.translation?` — ${w.translation}`:""}`).join("\n");
  const user = `
Generate ${input.words.length} multiple-choice quizzes.

Input words:
${wordsList}

For each word, return strict JSON with:
- sentence_target: ${input.targetLanguage} sentence containing the **word**
- sentence_known_masked: same sentence in ${input.knownLanguage}, target word replaced by "_____"
- options_known: ${input.numOptions} options in ${input.knownLanguage} (one correct + same-POS distractors)
- correct_index: 0-based index of correct option

Constraints:
- Only vocab/grammar at or below ${input.level}
- Short, natural, grammatical sentences
- Avoid idioms and obvious cognates

Return JSON: {"items":[{ "word":"...", "sentence_target":"...", "sentence_known_masked":"...", "options_known":["a","b","c","d"], "correct_index":0 }]}`;

  const resp = await client.chat.completions.create({
    model: input.model || "gpt-4o-mini",
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [{ role: "system", content: sys }, { role: "user", content: user }]
  });

  const json = JSON.parse(resp.choices[0]?.message?.content || "{}");
  return sanitize((json.items ?? []).map((it: any) => ({
    word: it.word,
    sentenceTarget: it.sentence_target,
    sentenceKnownMasked: it.sentence_known_masked,
    optionsKnown: it.options_known,
    correctIndex: it.correct_index
  })), input.numOptions);
}

async function generateAnthropic(input: GenerateInput): Promise<QuizItem[]> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const prompt = `
You are a precise ${input.targetLanguage} vocabulary quiz generator for ${input.level} learners.
Words:
${input.words.map((w,i)=>`${i+1}. ${w.term}${w.translation?` — ${w.translation}`:""}`).join("\n")}
Return strict JSON per spec:
{"items":[{ "word":"...", "sentence_target":"...", "sentence_known_masked":"...", "options_known":["a","b","c","d"], "correct_index":0 }]}`;

  const msg = await client.messages.create({
    model: input.model || "claude-3-haiku-20240307",
    temperature: 0.4,
    max_tokens: 1200,
    system: "Return valid JSON only.",
    messages: [{ role: "user", content: prompt }]
  });

  const text = (msg.content?.[0] as any)?.text || "{}";
  const json = JSON.parse(text);
  return sanitize((json.items ?? []).map((it: any) => ({
    word: it.word,
    sentenceTarget: it.sentence_target,
    sentenceKnownMasked: it.sentence_known_masked,
    optionsKnown: it.options_known,
    correctIndex: it.correct_index
  })), input.numOptions);
}

function sanitize(items: QuizItem[], n: number): QuizItem[] {
  return items.map(it => {
    const opts = Array.isArray(it.optionsKnown) ? Array.from(new Set(it.optionsKnown.filter(Boolean))) : [];
    while (opts.length < n) opts.push("—");
    const correctIdx = Math.min(Math.max(it.correctIndex ?? 0, 0), n-1);
    return {
      word: String(it.word || "").trim(),
      sentenceTarget: String(it.sentenceTarget || "").trim(),
      sentenceKnownMasked: String(it.sentenceKnownMasked || "").trim(),
      optionsKnown: opts.slice(0, n),
      correctIndex: correctIdx
    };
  });
}
