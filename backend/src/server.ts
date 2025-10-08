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

app.post("/api/quizzes/generate", async (req, res) => {
  try {
    const parsed = GenerateBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { target_language, known_language, level, words, options, metadata } = parsed.data;

    const quizSet = await prisma.quizSet.create({
      data: { targetLanguage: target_language, knownLanguage: known_language, level, metadata }
    });

    const items = await generateQuizzesWithLLM({
      targetLanguage: target_language,
      knownLanguage: known_language,
      level,
      words,
      numOptions: options.num_options,
      model: options.llm_model,
      seed: options.seed
    });

    const quizzes = await Promise.all(items.map((q, i) => prisma.quiz.create({
      data: {
        quizSetId: quizSet.id,
        word: q.word,
        sentenceTarget: q.sentenceTarget,
        sentenceKnownMasked: q.sentenceKnownMasked,
        optionsKnown: q.optionsKnown,
        correctIndex: q.correctIndex,
        indexInSet: i + 1,
        slug: `${quizSet.id}/${i + 1}`
      }
    })));

    res.json({
      quiz_set_id: quizSet.id,
      count: quizzes.length,
      items: quizzes.map(q => ({
        quiz_id: q.id,
        slug: q.slug,
        sentence_target: q.sentenceTarget,
        sentence_known_masked: q.sentenceKnownMasked,
        options_known: q.optionsKnown,
        correct_index: q.correctIndex
      }))
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
    options_known: q.optionsKnown
  });
});

app.get("/api/quiz-sets/:id/quizzes", async (req, res) => {
  const set = await prisma.quizSet.findUnique({ where: { id: req.params.id } });
  if (!set) return res.status(404).json({ error: "Not found" });
  const quizzes = await prisma.quiz.findMany({
    where: { quizSetId: set.id },
    orderBy: { indexInSet: "asc" },
    select: { id: true, indexInSet: true, word: true }
  });
  res.json({ quiz_set_id: set.id, items: quizzes.map(q => ({ quiz_id: q.id, index: q.indexInSet, word: q.word })) });
});

app.post("/api/quizzes/:quiz_id/answer", async (req, res) => {
  const body = z.object({
    choice_index: z.number().int().optional(),
    time_ms: z.number().int().min(0).optional(),
    action: z.enum(["answered", "skipped"])
  }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });

  const quiz = await prisma.quiz.findUnique({ where: { id: req.params.quiz_id } });
  if (!quiz) return res.status(404).json({ error: "Not found" });

  const { choice_index, action, time_ms } = body.data;
  const isCorrect = action === "answered" ? choice_index === quiz.correctIndex : null;

  await prisma.quizAnswer.create({
    data: { quizId: quiz.id, choiceIndex: choice_index ?? null, isCorrect, action, timeMs: time_ms ?? null }
  });

  res.json({ correct: isCorrect ?? false, correct_index: quiz.correctIndex });
});

app.get("/api/quiz-sets/:id/summary", async (req, res) => {
  const set = await prisma.quizSet.findUnique({ where: { id: req.params.id } });
  if (!set) return res.status(404).json({ error: "Not found" });

  const quizzes = await prisma.quiz.findMany({ where: { quizSetId: set.id }, orderBy: { indexInSet: "asc" } });
  const answers = await prisma.quizAnswer.findMany({ where: { quizId: { in: quizzes.map(q => q.id) } }, orderBy: { createdAt: "asc" } });

  const latest = new Map<string, typeof answers[number]>();
  for (const a of answers) latest.set(a.quizId, a);

  let correct = 0, incorrect = 0, skipped = 0;
  const items = quizzes.map(q => {
    const a = latest.get(q.id);
    let result: "correct" | "incorrect" | "skipped" = "skipped";
    if (a?.action === "answered") result = a.isCorrect ? "correct" : "incorrect";
    if (result === "correct") correct++; else if (result === "incorrect") incorrect++; else skipped++;
    return { quiz_id: q.id, word: q.word, result };
  });

  const total = items.length || 1;
  const overall_accuracy = correct / total;
  res.json({ quiz_set_id: set.id, overall_accuracy, counts: { correct, incorrect, skipped }, items });
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`API listening on :${PORT}`));
