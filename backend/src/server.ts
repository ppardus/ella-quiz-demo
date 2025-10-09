import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { z } from "zod";
import { prisma } from "./lib/prisma";
import { GenerateBody } from "./lib/validators";
import { generateQuizzesWithLLM } from "./services/generator";

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ALLOW_ORIGIN?.split(",") ?? "*" }));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

/** ---------- FLEXIBLE INPUT PARSER ---------- **/
function stripQuotes(s: string) {
  return s.replace(/^["'“”‘’]|["'“”‘’]$/g, "");
}
// separators: :, /, ;, arrows, dashes like "term -> translation"
const PAIR_SEP = /\s*(?::|\/|;|→|⇒|—|–|->|=>|\s-\s)\s*/;

function parseRawText(raw?: string): { term: string; translation?: string }[] {
  if (!raw) return [];
  const rows: { term: string; translation?: string }[] = [];
  const seen = new Set<string>();

  for (const origLine of raw.split(/\r?\n/)) {
    let line = origLine.trim();
    if (!line) continue;

    // CSV/TSV two columns when no obvious custom separator
    if (!PAIR_SEP.test(line) && /,|\t/.test(line)) {
      const csv = line.split(/\t|,/).map((s) => stripQuotes(s.trim()));
      if (csv.length >= 2) {
        const term = csv[0];
        const translation = csv[1];
        if (term && !seen.has(term)) {
          rows.push({ term, translation });
          seen.add(term);
        }
        continue;
      }
    }

    // General separators
    const parts = line.split(PAIR_SEP);
    if (parts.length >= 2) {
      const term = stripQuotes(parts[0].trim());
      const translation = stripQuotes(parts.slice(1).join(":").trim());
      if (term && !seen.has(term)) {
        rows.push({ term, translation });
        seen.add(term);
      }
      continue;
    }

    // Single term
    const term = stripQuotes(line);
    if (term && !seen.has(term)) {
      rows.push({ term });
      seen.add(term);
    }
  }

  return rows;
}
/** ------------------------------------------- **/

app.post("/api/quizzes/generate", async (req, res) => {
  try {
    const parsed = GenerateBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { target_language, known_language, level, options, metadata } = parsed.data;

    // Use words[] if provided; otherwise parse raw_text flexibly
    const words =
      parsed.data.words && parsed.data.words.length
        ? parsed.data.words
        : parseRawText(parsed.data.raw_text);

    const quizSet = await prisma.quizSet.create({
      data: {
        targetLanguage: target_language,
        knownLanguage: known_language,
        level,
        metadata,
      },
    });

    const items = await generateQuizzesWithLLM({
      targetLanguage: target_language,
      knownLanguage: known_language,
      level,
      words,
      numOptions: options.num_options,
      model: options.llm_model,
      seed: options.seed,
    });

    const quizzes = await Promise.all(
      items.map((q, i) =>
        prisma.quiz.create({
          data: {
            quizSetId: quizSet.id,
            word: q.word,
            sentenceTarget: q.sentenceTarget,
            sentenceKnownMasked: q.sentenceKnownMasked,
            optionsKnown: q.optionsKnown,
            correctIndex: q.correctIndex,
            indexInSet: i + 1,
            slug: `${quizSet.id}/${i + 1}`,
          },
        })
      )
    );

    res.json({
      quiz_set_id: quizSet.id,
      count: quizzes.length,
      items: quizzes.map((q) => ({
        quiz_id: q.id,
        slug: q.slug,
        sentence_target: q.sentenceTarget,
        sentence_known_masked: q.sentenceKnownMasked,
        options_known: q.optionsKnown,
        correct_index: q.correctIndex,
      })),
    });
  } catch (err: any) {
    console.error(err);
    res.status(501).json({ error: err?.message ?? "Generation failed" });
  }
});

app.get("/api/quizzes/:quiz_id", async (req, res) => {
  const q = await prisma.quiz.findUnique({ where: { id: req.params.quiz_id } });
  if (!q) return res.status(404).json({ error: "Not found" });
  const total = await prisma.quiz.count({ where: { quizSetId: q.quizSetId } });
  res.json({
    quiz_id: q.id,
    quiz_set_id: q.quizSetId,
    index: q.indexInSet,
    total,
    sentence_target: q.sentenceTarget,
    sentence_known_masked: q.sentenceKnownMasked,
    options_known: q.optionsKnown,
  });
});

app.get("/api/quiz-sets/:id/quizzes", async (req, res) => {
  const set = await prisma.quizSet.findUnique({ where: { id: req.params.id } });
  if (!set) return res.status(404).json({ error: "Not found" });
  const quizzes = await prisma.quiz.findMany({
    where: { quizSetId: set.id },
    orderBy: { indexInSet: "asc" },
    select: { id: true, indexInSet: true, word: true },
  });
  res.json({
    quiz_set_id: set.id,
    items: quizzes.map((q) => ({ quiz_id: q.id, index: q.indexInSet, word: q.word })),
  });
});

app.post("/api/quizzes/:quiz_id/answer", async (req, res) => {
  const body = z
    .object({
      choice_index: z.number().int().optional(),
      time_ms: z.number().int().min(0).optional(),
      action: z.enum(["answered", "skipped"]),
    })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });

  const quiz = await prisma.quiz.findUnique({ where: { id: req.params.quiz_id } });
  if (!quiz) return res.status(404).json({ error: "Not found" });

  const { choice_index, action, time_ms } = body.data;
  const isCorrect = action === "answered" ? choice_index === quiz.correctIndex : null;

  await prisma.quizAnswer.create({
    data: {
      quizId: quiz.id,
      choiceIndex: choice_index ?? null,
      isCorrect,
      action,
      timeMs: time_ms ?? null,
    },
  });

  res.json({ correct: isCorrect ?? false, correct_index: quiz.correctIndex });
});

/** ---------- NEW: record “Next” click with timestamp ---------- **/
app.post("/api/quizzes/:quiz_id/next-click", async (req, res) => {
  const quiz = await prisma.quiz.findUnique({ where: { id: req.params.quiz_id } });
  if (!quiz) return res.status(404).json({ error: "Not found" });
  const from_index = Number(req.body?.from_index ?? quiz.indexInSet);
  await prisma.quizEvent.create({
    data: { quizId: quiz.id, type: "next_click", data: { from_index } },
  });
  res.json({ ok: true, recorded_at: new Date().toISOString() });
});
/** ---------------------------------------------------------------- **/

app.get("/api/quiz-sets/:id/summary", async (req, res) => {
  const set = await prisma.quizSet.findUnique({ where: { id: req.params.id } });
  if (!set) return res.status(404).json({ error: "Not found" });

  const quizzes = await prisma.quiz.findMany({
    where: { quizSetId: set.id },
    orderBy: { indexInSet: "asc" },
  });

  const answers = await prisma.quizAnswer.findMany({
    where: { quizId: { in: quizzes.map((q) => q.id) } },
    orderBy: { createdAt: "asc" },
  });

  const events = await prisma.quizEvent.findMany({
    where: { quizId: { in: quizzes.map((q) => q.id) } },
    orderBy: { createdAt: "asc" },
  });

  // latest answer per quiz
  const latest = new Map<string, (typeof answers)[number]>();
  for (const a of answers) latest.set(a.quizId, a);

  let correct = 0,
    incorrect = 0,
    skipped = 0;
  const items = quizzes.map((q) => {
    const a = latest.get(q.id);
    let result: "correct" | "incorrect" | "skipped" = "skipped";
    let answered_at: string | null = null;

    if (a) {
      if (a.action === "answered") result = a.isCorrect ? "correct" : "incorrect";
      if (a.createdAt) answered_at = a.createdAt.toISOString();
    }

    if (result === "correct") correct++;
    else if (result === "incorrect") incorrect++;
    else skipped++;

    return { quiz_id: q.id, word: q.word, result, answered_at };
  });

  const total = items.length || 1;
  const overall_accuracy = correct / total;

  res.json({
    quiz_set_id: set.id,
    overall_accuracy,
    counts: { correct, incorrect, skipped },
    items,
    events: events.map((e) => ({
      type: e.type,
      quiz_id: e.quizId,
      created_at: e.createdAt.toISOString(),
      ...(e.data as any),
    })),
  });
});

app.post("/api/quizzes/:quiz_id/next-click", async (req, res) => {
  const quiz = await prisma.quiz.findUnique({ where: { id: req.params.quiz_id } });
  if (!quiz) return res.status(404).json({ error: "Not found" });
  const from_index = Number((req.body?.from_index ?? quiz.indexInSet));
  await prisma.quizEvent.create({ data: { quizId: quiz.id, type: "next_click", data: { from_index } } });
  res.json({ ok: true, recorded_at: new Date().toISOString() });
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`API listening on :${PORT}`));
