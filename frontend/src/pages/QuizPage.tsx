// frontend/src/pages/QuizPage.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  getQuiz,
  nextUnanswered,
  continueAttempt,
  answerQuiz,
} from "../lib/api";
import { Copy } from "lucide-react";
import ProgressBar from "../components/ProgressBar";
import Badge from "../components/Badge";

/* --------------------------- attempt helpers ---------------------------- */

function makeAttemptToken() {
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  );
}
function attemptKey(setId: string) {
  return `ella_attempt_${setId}`;
}
function totalKey(setId: string) {
  return `ella_total_${setId}`;
}

/** Ensure URL has a stable attempt; reuse stored or create. */
function ensureAttemptInUrl(
  sp: URLSearchParams,
  setSp: (s: URLSearchParams, o?: { replace?: boolean }) => void,
  setId: string
): string | null {
  if (!setId) return ""; // legacy path without sets
  const urlAttempt = sp.get("attempt") || "";
  const stored = localStorage.getItem(attemptKey(setId)) || "";
  const token = urlAttempt || stored || makeAttemptToken();
  if (token && stored !== token) localStorage.setItem(attemptKey(setId), token);
  if (urlAttempt !== token) {
    const next = new URLSearchParams(sp);
    next.set("attempt", token);
    setSp(next, { replace: true });
    return null; // will re-run after URL updates
  }
  return token;
}

/* ------------------------ generic highlight helpers --------------------- */

function escapeHtml(s: string) {
  return s
    .replaceAll(/&/g, "&amp;")
    .replaceAll(/</g, "&lt;")
    .replaceAll(/>/g, "&gt;")
    .replaceAll(/"/g, "&quot;")
    .replaceAll(/'/g, "&#39;");
}

function highlightBySpan(sentence: string, span?: [number, number] | null) {
  if (!sentence || !span || span.length !== 2) return null;
  const [a, b] = span;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b <= a || b > sentence.length) return null;
  const before = escapeHtml(sentence.slice(0, a));
  const mid = escapeHtml(sentence.slice(a, b));
  const after = escapeHtml(sentence.slice(b));
  return `${before}<mark class="tw-highlight">${mid}</mark>${after}`;
}

/** Unicode-aware, language-agnostic fallback using Intl.Segmenter if available. */
function highlightGeneric(sentence: string, target: string) {
  if (!sentence || !target) return escapeHtml(sentence);

  const s = sentence.normalize("NFC");
  const t = target.normalize("NFC").trim();
  if (!t) return escapeHtml(sentence);

  // simple case-insensitive search first
  const ix = s.toLocaleLowerCase().indexOf(t.toLocaleLowerCase());
  if (ix >= 0) {
    const html = highlightBySpan(s, [ix, ix + t.length]);
    return html || escapeHtml(sentence);
  }

  // try to match whole-word via segmenter (best-effort)
  const AnySeg: any = (Intl as any).Segmenter;
  if (typeof AnySeg === "function") {
    const seg = new AnySeg(undefined, { granularity: "word" });
    // @ts-ignore – TS doesn’t know segment() iterable type
    for (const piece of seg.segment(s)) {
      if (!piece?.isWordLike) continue;
      const segText = String(piece.segment || "");
      if (segText && segText.toLocaleLowerCase() === t.toLocaleLowerCase()) {
        const start = Number(piece.index || 0);
        const end = start + segText.length;
        const html = highlightBySpan(s, [start, end]);
        return html || escapeHtml(sentence);
      }
    }
  }

  return escapeHtml(sentence);
}

/* ------------------------------- component ------------------------------ */

export default function QuizPage() {
  const { quizId } = useParams();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();

  const setId = sp.get("set") ?? "";

  // resolve attempt in URL before boot
  const [attempt, setAttempt] = useState<string | null>(() =>
    ensureAttemptInUrl(sp, setSp, setId)
  );
  useEffect(() => {
    const tok = ensureAttemptInUrl(sp, setSp, setId);
    if (tok !== null) {
      setAttempt(tok);
      if (setId && tok) localStorage.setItem(attemptKey(setId), tok);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString(), setId]);

  const [quiz, setQuiz] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const [choicesDisabled, setChoicesDisabled] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [correctIndex, setCorrectIndex] = useState<number | null>(null);

  const [currentIndex, setCurrentIndex] = useState<number>(() => {
    const i = Number(sp.get("i") || "1");
    return Number.isFinite(i) && i > 0 ? i : 1;
  });
  const [total, setTotal] = useState<number>(() => {
    const cached = setId ? Number(localStorage.getItem(totalKey(setId)) || "0") : 0;
    const tUrl = Number(sp.get("t") || "0");
    return cached || tUrl || 1;
  });

  const startMs = useRef<number>(Date.now());
  const [copied, setCopied] = useState(false);

  // Boot only after attempt is present in URL
  useEffect(() => {
    if (attempt === null) return;
    let mounted = true;

    async function normalizeToFirstUnanswered() {
      if (!setId || !attempt) return { ok: true };

      const data = await nextUnanswered(setId, attempt);
      const totalN = Number(data?.total) || 0;
      if (totalN > 0) {
        setTotal(totalN);
        localStorage.setItem(totalKey(setId), String(totalN));
      }
      if (data?.status === "completed") {
        nav(`/summary/${setId}?attempt=${encodeURIComponent(attempt)}`, { replace: true });
        return { ok: false };
      }
      const nextId = data?.question?.quiz_id;
      const nextIdx = data?.question?.index;
      if (nextId && nextIdx) {
        if (nextId !== quizId) {
          nav(
            `/quiz/${nextId}?set=${setId}&i=${nextIdx}&t=${totalN || data.total}&attempt=${encodeURIComponent(attempt)}`,
            { replace: true }
          );
          return { ok: false };
        } else {
          // already at first unanswered; refresh URL's i/t if stale
          const iUrl = Number(sp.get("i") || "0");
          const tUrl = Number(sp.get("t") || "0");
          if (iUrl !== nextIdx || tUrl !== totalN) {
            const nextSp = new URLSearchParams(sp);
            nextSp.set("i", String(nextIdx));
            if (totalN) nextSp.set("t", String(totalN));
            setSp(nextSp, { replace: true });
          }
          setCurrentIndex(nextIdx);
          if (totalN) setTotal(totalN);
        }
      }
      return { ok: true };
    }

    async function boot() {
      setLoading(true);
      setErrMsg(null);

      try {
        const step = await normalizeToFirstUnanswered();
        if (!step.ok) return;

        const d = await getQuiz(quizId!);
        if (!mounted) return;
        setQuiz(d);

        // normalize URL/locals using server index/total if available
        if (typeof d.index === "number") setCurrentIndex(d.index);
        if (typeof d.total === "number" && d.total > 0) {
          setTotal(d.total);
          localStorage.setItem(totalKey(setId), String(d.total));
        }
        const iUrl = Number(sp.get("i") || "0");
        const tUrl = Number(sp.get("t") || "0");
        const needRewrite =
          (typeof d.index === "number" && d.index !== iUrl) ||
          (typeof d.total === "number" && d.total !== tUrl);
        if (needRewrite) {
          const nextSp = new URLSearchParams(sp);
          if (typeof d.index === "number") nextSp.set("i", String(d.index));
          if (typeof d.total === "number") nextSp.set("t", String(d.total));
          setSp(nextSp, { replace: true });
        }
      } catch (e: any) {
        console.error("Boot failed", e);
        setErrMsg("Could not reach the quiz server or load this quiz.");
      } finally {
        setLoading(false);
      }

      // reset per-question UI state
      startMs.current = Date.now();
      setChoicesDisabled(false);
      setPicked(null);
      setCorrectIndex(null);
    }

    boot();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quizId, setId, attempt]);

  const pct = useMemo(() => Math.max(1, currentIndex), [currentIndex]);

  async function choose(idx: number) {
    if (choicesDisabled || correctIndex !== null || !attempt) return;
    setPicked(idx);
    setChoicesDisabled(true);
    const elapsed = Date.now() - startMs.current;

    try {
      if (setId) localStorage.setItem(attemptKey(setId), attempt);
      const data = await answerQuiz(quizId!, {
        choice_index: idx,
        time_ms: elapsed,
        action: "answered",
        attempt,
      });
      setCorrectIndex(data.correct_index);
    } catch (e: any) {
      console.error("Answer failed", e);
      setErrMsg("Could not submit your answer.");
      setChoicesDisabled(false);
    }
  }

  async function skip() {
    if (choicesDisabled || correctIndex !== null || !attempt) return;
    setChoicesDisabled(true);
    const elapsed = Date.now() - startMs.current;

    try {
      if (setId) localStorage.setItem(attemptKey(setId), attempt);
      await answerQuiz(quizId!, { action: "skipped", time_ms: elapsed, attempt });
    } catch (e: any) {
      console.error("Skip failed", e);
      setErrMsg("Could not submit skip.");
      setChoicesDisabled(false);
      return;
    }

    // Immediately advance using server’s first-unanswered
    try {
      const data = await continueAttempt(setId, attempt);
      const totalN = Number(data?.total) || total;
      if (totalN > 0) {
        setTotal(totalN);
        localStorage.setItem(totalKey(setId), String(totalN));
      }
      if (data.status === "completed") {
        nav(`/summary/${setId}?attempt=${encodeURIComponent(attempt)}`);
      } else {
        nav(
          `/quiz/${data.next_quiz_id}?set=${setId}&i=${data.index}&t=${totalN}&attempt=${encodeURIComponent(attempt)}`
        );
      }
    } catch (e: any) {
      console.error("Continue after skip failed:", e);
      setErrMsg("Could not load the next question after skip.");
      setChoicesDisabled(false);
    }
  }

  async function next() {
    if (!setId || !attempt) {
      nav(`/summary/${setId}${attempt ? `?attempt=${encodeURIComponent(attempt)}` : ""}`);
      return;
    }
    try {
      const data = await continueAttempt(setId, attempt);
      const totalN = Number(data?.total) || total;
      if (totalN > 0) {
        setTotal(totalN);
        localStorage.setItem(totalKey(setId), String(totalN));
      }
      if (data.status === "completed") {
        nav(`/summary/${setId}?attempt=${encodeURIComponent(attempt)}`);
      } else {
        nav(
          `/quiz/${data.next_quiz_id}?set=${setId}&i=${data.index}&t=${totalN}&attempt=${encodeURIComponent(attempt)}`
        );
      }
    } catch (e: any) {
      console.error("Continue failed:", e);
      setErrMsg("Could not load the next question.");
    }
  }

  if (attempt === null) return null;
  if (loading && !quiz) return <div className="text-gray-600">Loading quiz…</div>;
  if (errMsg && !quiz) return <div className="text-red-600">{errMsg}</div>;
  if (!quiz) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(quiz.quiz_set_id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  // Build highlighted sentence: prefer span from API; otherwise generic fallback.
  const htmlTitle =
    highlightBySpan(quiz.sentence_target, quiz.surface_span as [number, number] | null) ??
    highlightGeneric(quiz.sentence_target, quiz.word);

  return (
    <div className="bg-white shadow-xl rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-28">
            <ProgressBar value={pct} total={total} />
          </div>
          <div className="text-sm text-gray-600">
            {currentIndex} of {total}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Badge>
            Set: <span className="font-mono">{quiz.quiz_set_id.slice(0, 8)}</span>
          </Badge>
          <button
            onClick={handleCopy}
            className="text-gray-500 hover:text-indigo-600 transition ml-1"
            title="Copy full ID"
          >
            <Copy size={14} />
          </button>
          {copied && <span className="text-xs text-green-600 ml-1">Copied!</span>}

          {/* Difficulty tag (informational only) */}
          {quiz.difficulty_label && (
            <span
              className={
                "ml-2 inline-block px-2 py-0.5 text-xs rounded-full border " +
                (quiz.difficulty_label === "Easy"
                  ? "bg-green-50 text-green-700 border-green-200"
                  : quiz.difficulty_label === "Moderate"
                  ? "bg-yellow-50 text-yellow-700 border-yellow-200"
                  : "bg-red-50 text-red-700 border-red-200")
              }
              title={
                quiz.difficulty_score != null
                  ? `Score ${quiz.difficulty_score}/10`
                  : undefined
              }
            >
              {quiz.difficulty_label}
            </span>
          )}
        </div>
      </div>

      <h2
        className="text-xl font-semibold mb-2 leading-snug"
        dangerouslySetInnerHTML={{ __html: htmlTitle }}
      />
      <p className="text-gray-600 mb-6">{quiz.sentence_known_masked}</p>

      <div className="grid grid-cols-1 gap-3">
        {quiz.options_known.map((opt: string, idx: number) => {
          const isPicked = picked === idx;
          const isCorrect = correctIndex !== null && idx === correctIndex;
          const isWrongPick = correctIndex !== null && isPicked && !isCorrect;

          const cls = [
            "w-full text-left px-4 py-3 rounded-lg border transition",
            "disabled:opacity-60",
            isCorrect
              ? "bg-green-50 border-green-400"
              : isWrongPick
              ? "bg-red-50 border-red-400"
              : isPicked
              ? "bg-indigo-50 border-indigo-400"
              : "hover:bg-gray-50",
          ].join(" ");

          return (
            <button
              key={idx}
              className={cls}
              disabled={choicesDisabled && !isPicked}
              onClick={() => choose(idx)}
            >
              <span className="font-mono mr-2">
                {String.fromCharCode(97 + idx)})
              </span>{" "}
              {opt}
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex items-center justify-end gap-3">
        {/* No Back button per requirements */}
        {correctIndex === null && (
          <button
            onClick={skip}
            className="px-4 py-2 rounded-lg border text-gray-700 hover:bg-gray-50"
          >
            Skip
          </button>
        )}
        {correctIndex !== null && (
          <button
            onClick={next}
            className="px-5 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
          >
            {currentIndex < total ? "Next" : "Finish"}
          </button>
        )}
      </div>

      {errMsg && <div className="mt-4 text-sm text-red-600">{errMsg}</div>}
    </div>
  );
}
