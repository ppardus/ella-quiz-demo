import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { z } from "zod";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

import { prisma } from "./lib/prisma.js";
import { GenerateBody } from "./lib/validators.js";
import { generateQuizzesWithLLM } from "./services/generator.js";

const app = express();
app.use(helmet());

// ---------- CORS ----------
const allowlist = (process.env.CORS_ALLOW_ORIGIN ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(cors({ origin: allowlist.length ? allowlist : true }));

app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

/** ---------- helpers ---------- **/
function stripQuotes(s: string) { return s.replace(/^["'“”‘’]|["'“”‘’]$/g, ""); }
const PAIR_SEP = /\s*(?::|\/|;|→|⇒|—|–|->|=>|\s-\s)\s*/;

type Word = { term: string; translation?: string };

function parseRawText(raw?: string): Word[] {
  if (!raw) return [];
  const rows: Word[] = [];
  const seen = new Set<string>();

  for (const origLine of raw.split(/\r?\n/)) {
    const line = origLine.trim();
    if (!line) continue;

    if (!PAIR_SEP.test(line) && /,|\t/.test(line)) {
      const csv = line.split(/\t|,/).map((s) => stripQuotes(s.trim()));
      if (csv.length >= 2) {
        const term = csv[0];
        const translation = csv[1];
        if (term && !seen.has(term)) { rows.push({ term, translation: translation ?? undefined }); seen.add(term); }
        continue;
      }
    }

    const parts = line.split(PAIR_SEP);
    if (parts.length >= 2) {
      const term = stripQuotes(parts[0].trim());
      const translationJoined = parts.slice(1).join(":").trim();
      const translation = stripQuotes(translationJoined);
      if (term && !seen.has(term)) { rows.push({ term, translation: translation || undefined }); seen.add(term); }
      continue;
    }

    const term = stripQuotes(line);
    if (term && !seen.has(term)) { rows.push({ term }); seen.add(term); }
  }
  return rows;
}

function formatTime(ms?: number | null) {
  if (ms == null) return "–";
  return (ms / 1000).toFixed(1) + "s";
}

function buildSetLink(baseUrl: string, firstQuizId: string, setId: string, total: number) {
  return `${baseUrl}/quiz/${firstQuizId}?set=${setId}&i=1&t=${total}`;
}
/** ------------------------------------------- **/

/** ---------- API ROUTES ---------- **/

// Generate a set
app.post("/api/quizzes/generate", async (req, res) => {
  try {
    const parsed = GenerateBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { target_language, known_language, level, options, metadata } = parsed.data;

    const words: Word[] =
      parsed.data.words && parsed.data.words.length
        ? parsed.data.words.map((w) => ({ term: w.term, translation: w.translation ?? undefined }))
        : parseRawText(parsed.data.raw_text);

    const quizSet = await prisma.quizSet.create({
      data: { targetLanguage: target_language, knownLanguage: known_language, level, metadata: metadata ?? null },
    });

    const items = await generateQuizzesWithLLM({
      targetLanguage: target_language,
      knownLanguage: known_language,
      level,
      words,
      numOptions: options.num_options,
      model: options.llm_model,
      seed: options.seed,
      shuffle: true,
    });

    const quizzes = await Promise.all(
      items.map((q, i) =>
        prisma.quiz.create({
          data: {
            quizSetId: quizSet.id,
            word: q.word,
            sentenceTarget: q.sentenceTarget,
            sentenceKnownMasked: q.sentenceKnownMasked,
            optionsKnown: q.optionsKnown as any,
            correctIndex: q.correctIndex,
            indexInSet: i + 1,
            slug: `${quizSet.id}/${i + 1}`,
            difficultyScore: q.difficultyScore ?? null,
            difficultyLabel: q.difficultyLabel ?? null,
            difficultyReason: q.difficultyReason ?? null,
          },
        })
      )
    );

    const baseUrl = process.env.APP_BASE_URL || "http://localhost:5173";
    const firstQuiz = quizzes[0];
    const link = firstQuiz ? buildSetLink(baseUrl, firstQuiz.id, quizSet.id, quizzes.length) : null;

    res.json({
      quiz_set_id: quizSet.id,
      count: quizzes.length,
      link,
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

// Link builder
app.get("/api/quiz-sets/:id/link", async (req, res) => {
  const set = await prisma.quizSet.findUnique({ where: { id: req.params.id } });
  if (!set) return res.status(404).json({ error: "Not found" });

  const first = await prisma.quiz.findFirst({
    where: { quizSetId: set.id },
    orderBy: { indexInSet: "asc" },
    select: { id: true },
  });
  if (!first) return res.status(404).json({ error: "No quizzes in set" });

  const total = await prisma.quiz.count({ where: { quizSetId: set.id } });
  const baseUrl = process.env.APP_BASE_URL || "http://localhost:5173";
  const link = buildSetLink(baseUrl, first.id, set.id, total);

  res.json({ quiz_set_id: set.id, total, link });
});

// Quiz details
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
    difficulty_label: q.difficultyLabel ?? null,
    difficulty_score: q.difficultyScore ?? null,
  });
});

// List quizzes in set
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

/** ---------- Attempt-aware flow ---------- **/

// First unanswered for an attempt
app.get("/api/quiz-sets/:id/next", async (req, res) => {
  const setId = req.params.id;
  const attempt = String(req.query.attempt ?? "").trim();
  if (!attempt) return res.status(400).json({ error: "Missing attempt" });

  const set = await prisma.quizSet.findUnique({ where: { id: setId } });
  if (!set) return res.status(404).json({ error: "Not found" });

  const quizzes = await prisma.quiz.findMany({
    where: { quizSetId: setId },
    orderBy: { indexInSet: "asc" },
    select: { id: true, indexInSet: true },
  });
  const ids = quizzes.map((q) => q.id);
  const total = ids.length;

  const answers = await prisma.quizAnswer.findMany({
    where: { quizId: { in: ids }, attemptToken: attempt },
    select: { quizId: true, action: true },
  });
  const answered = new Set<string>(answers.map((a) => a.quizId)); // both answered & skipped count as “answered” for flow

  const next = quizzes.find((q) => !answered.has(q.id));
  if (!next) {
    return res.json({ status: "completed", total });
  }
  res.json({
    status: "in_progress",
    total,
    question: { quiz_id: next.id, index: next.indexInSet },
  });
});

// Continue (same as next, but return minimal fields)
app.get("/api/quiz-sets/:id/continue", async (req, res) => {
  const setId = req.params.id;
  const attempt = String(req.query.attempt ?? "").trim();
  if (!attempt) return res.status(400).json({ error: "Missing attempt" });

  const quizzes = await prisma.quiz.findMany({
    where: { quizSetId: setId },
    orderBy: { indexInSet: "asc" },
    select: { id: true, indexInSet: true },
  });
  const ids = quizzes.map((q) => q.id);
  const total = quizzes.length;

  const answers = await prisma.quizAnswer.findMany({
    where: { quizId: { in: ids }, attemptToken: attempt },
    select: { quizId: true },
  });
  const answered = new Set<string>(answers.map((a) => a.quizId));

  const next = quizzes.find((q) => !answered.has(q.id));
  if (!next) return res.json({ status: "completed", total });
  res.json({
    status: "in_progress",
    next_quiz_id: next.id,
    index: next.indexInSet,
    total,
  });
});

// Answer or skip (idempotent per quiz+attempt)
app.post("/api/quizzes/:quiz_id/answer", async (req, res) => {
  const body = z.object({
    choice_index: z.number().int().optional(),
    time_ms: z.number().int().min(0).optional(),
    action: z.enum(["answered", "skipped"]),
    attempt: z.string().min(6),
  }).safeParse(req.body);
  console.log(body)

  if (!body.success) return res.status(400).json({ error: body.error.flatten() });

  const quiz = await prisma.quiz.findUnique({ where: { id: req.params.quiz_id } });
  if (!quiz) return res.status(404).json({ error: "Not found" });

  const { choice_index, action, time_ms, attempt } = body.data;
  const isCorrect = action === "answered" ? ((choice_index ?? -1) === quiz.correctIndex) : null;

  try {
    await prisma.quizAnswer.create({
      data: {
        quizId: quiz.id,
        attemptToken: attempt ?? null,
        choiceIndex: choice_index ?? null,
        isCorrect,
        action,
        timeMs: time_ms ?? null,
      },
    });
    return res.json({ correct: Boolean(isCorrect), correct_index: quiz.correctIndex, already_recorded: false });
  } catch (e: any) {
    // If unique constraint hit (already answered for this attempt), return idempotent result
    if (String(e?.code) === "P2002") {
      const prev = await prisma.quizAnswer.findFirst({
        where: { quizId: quiz.id, attemptToken: attempt },
        orderBy: { createdAt: "asc" },
      });
      return res.json({ correct: Boolean(prev?.isCorrect), correct_index: quiz.correctIndex, already_recorded: true });
    }
    console.error(e);
    return res.status(500).json({ error: "Failed to record answer" });
  }
});

/** ---------- (optional) record “Next” click with timestamp ---------- **/
app.post("/api/quizzes/:quiz_id/next-click", async (req, res) => {
  const quiz = await prisma.quiz.findUnique({ where: { id: req.params.quiz_id } });
  if (!quiz) return res.status(404).json({ error: "Not found" });
  const from_index = Number(req.body?.from_index ?? quiz.indexInSet);
  await prisma.quizEvent.create({
    data: { quizId: quiz.id, type: "next_click", data: { from_index } },
  });
  res.json({ ok: true, recorded_at: new Date().toISOString() });
});

/** ---------- Summary (attempt-aware) ---------- **/
app.get("/api/quiz-sets/:id/summary", async (req, res) => {
  const set = await prisma.quizSet.findUnique({ where: { id: req.params.id } });
  if (!set) return res.status(404).json({ error: "Not found" });

  const attempt = (req.query.attempt ?? "").toString().trim();

  const quizzes = await prisma.quiz.findMany({
    where: { quizSetId: set.id },
    orderBy: { indexInSet: "asc" },
  });
  const quizIds = quizzes.map((q) => q.id);

  const answers = await prisma.quizAnswer.findMany({
    where: {
      quizId: { in: quizIds },
      ...(attempt ? { attemptToken: attempt } : {}),
    },
    orderBy: { createdAt: "asc" },
  });

  const events = await prisma.quizEvent.findMany({
    where: { quizId: { in: quizIds } },
    orderBy: { createdAt: "asc" },
  });

  // Latest per quiz for this attempt (if attempt provided), otherwise latest overall
  const latest = new Map<string, (typeof answers)[number]>();
  for (const a of answers) latest.set(a.quizId, a);

  let correct = 0, incorrect = 0, skipped = 0, unanswered = 0;

  const byDifficulty = { Easy: 0, Moderate: 0, Hard: 0, Unknown: 0 };
  for (const q of quizzes) {
    const label = (q as any).difficultyLabel as string | null;
    if (label === "Easy" || label === "Moderate" || label === "Hard") byDifficulty[label]++;
    else byDifficulty.Unknown++;
  }

  const items = quizzes.map((q) => {
    const a = latest.get(q.id);
    let result: "correct" | "incorrect" | "skipped" | "unanswered" = "unanswered";
    let answered_at: string | null = null;
    let time_ms: number | null = null;

    if (a) {
      if (a.action === "answered") {
        result = a.isCorrect ? "correct" : "incorrect";
        time_ms = a.timeMs ?? null;
      } else if (a.action === "skipped") {
        result = "skipped";
        time_ms = a.timeMs ?? null;
      }
      if (a.createdAt) answered_at = a.createdAt.toISOString();
    }

    if (result === "correct") correct++;
    else if (result === "incorrect") incorrect++;
    else if (result === "skipped") skipped++;
    else unanswered++;

    const formatted_time = formatTime(time_ms);
    return { quiz_id: q.id, word: q.word, result, formatted_time, answered_at, difficulty_label: q.difficultyLabel ?? null, difficulty_score: q.difficultyScore ?? null, };
  });

  const total = items.length || 1;
  const attempted = total - unanswered;
  const denom = attempted || 1;
  const overall_accuracy = correct / denom; // exclude skipped & unanswered from accuracy

  res.json({
    quiz_set_id: set.id,
    overall_accuracy,
    counts: { correct, incorrect, skipped, unanswered },
    difficulty: byDifficulty,
    items,
    events: events.map((e) => ({
      type: e.type,
      quiz_id: e.quizId,
      created_at: e.createdAt.toISOString(),
      ...(e.data as any),
    })),
  });
});

/** ---------- SPA STATIC SERVE (fallback) ---------- **/

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FRONTEND_DIST_ENV = process.env.FRONTEND_DIST;
const candidatePaths = [
  FRONTEND_DIST_ENV,
  path.resolve(__dirname, "../frontend/dist"),
  path.resolve(__dirname, "../../frontend/dist"),
  path.resolve(process.cwd(), "frontend/dist"),
].filter(Boolean) as string[];

let frontendDist = "";
for (const p of candidatePaths) {
  try {
    if (fs.existsSync(p) && fs.existsSync(path.join(p, "index.html"))) {
      frontendDist = p;
      break;
    }
  } catch {}
}

if (frontendDist) {
  app.use(express.static(frontendDist, { index: false, maxAge: "1h" }));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(frontendDist, "index.html"));
  });
} else {
  app.all(/^\/api(\/.*)?$/, (_req, res) => {
    res.status(404).json({ error: "API route not found" });
  });
}

/** -------------------------------------------------------------------- **/

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`API listening on :${PORT}`));
