import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { getQuiz, listQuizzes, submitAnswer } from "../lib/api";
import { Copy } from "lucide-react";
import ProgressBar from "../components/ProgressBar";
import Badge from "../components/Badge";

export default function QuizPage() {
  const { quizId } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const setId = sp.get("set") ?? "";
  const i = Number(sp.get("i") ?? "1");
  const t = Number(sp.get("t") ?? "1");
  const attempt = sp.get("attempt") || "";

  const [quiz, setQuiz] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [choicesDisabled, setChoicesDisabled] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [correctIndex, setCorrectIndex] = useState<number | null>(null);
  const [ids, setIds] = useState<{ quiz_id: string; index: number }[]>([]);
  const startMs = useRef<number>(Date.now());

  useEffect(() => {
    let mounted = true;
    setLoading(true);

    async function enforceResume() {
      if (setId && attempt) {
        const res = await fetch(`/api/quiz-sets/${setId}/next?attempt=${encodeURIComponent(attempt)}`);
        const data = await res.json();
        if (data?.status === "completed") {
          nav(`/summary/${setId}?attempt=${encodeURIComponent(attempt)}`, { replace: true });
          return;
        }
        const nextId = data?.question?.quiz_id;
        const nextIndex = data?.question?.index;
        if (nextId && nextId !== quizId) {
          nav(
            `/quiz/${nextId}?set=${setId}&i=${nextIndex}&t=${t}&attempt=${encodeURIComponent(attempt)}`,
            { replace: true }
          );
          return;
        }
      }
      // Load current quiz if no redirect needed
      getQuiz(quizId!).then(d => { if (mounted) setQuiz(d); }).finally(()=>setLoading(false));
      if (setId) listQuizzes(setId).then(d => setIds(d.items.map((x:any)=>({quiz_id:x.quiz_id,index:x.index}))));
    }
    enforceResume();

    startMs.current = Date.now();
    setChoicesDisabled(false); setPicked(null); setCorrectIndex(null);
    return () => { mounted = false; };
  }, [quizId, setId, attempt, t, nav]);

  const pct = useMemo(() => Math.max(1, i), [i]);

  async function choose(idx: number) {
    if (choicesDisabled || correctIndex !== null) return;
    setPicked(idx); setChoicesDisabled(true);
    const elapsed = Date.now() - startMs.current;

    const payload = { choice_index: idx, time_ms: elapsed, action: "answered", attempt };
    const res = attempt
      ? await (await fetch(`/api/quizzes/${quizId}/answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })).json()
      : await submitAnswer(quizId!, payload as any);

    setCorrectIndex(res.correct_index);
  }

  async function skip() {
    if (choicesDisabled || correctIndex !== null) return;
    setChoicesDisabled(true);
    const elapsed = Date.now() - startMs.current;
    const payload = { action: "skipped", time_ms: elapsed, attempt };
    await fetch(`/api/quizzes/${quizId}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    // Show Next/Finish immediately after a skip
    setCorrectIndex(-1);
  }

  async function next() {
    if (!setId) {
      nav(`/summary/${setId}${attempt ? `?attempt=${encodeURIComponent(attempt)}` : ""}`);
      return;
    }
    if (attempt) {
      const r = await fetch(`/api/quiz-sets/${setId}/continue?attempt=${encodeURIComponent(attempt)}`);
      const data = await r.json();
      if (data.status === "completed") {
        nav(`/summary/${setId}?attempt=${encodeURIComponent(attempt)}`);
      } else {
        nav(`/quiz/${data.next_quiz_id}?set=${setId}&i=${data.index}&t=${t}&attempt=${encodeURIComponent(attempt)}`);
      }
      return;
    }
    // legacy fallback (no attempt): use preloaded ids
    if (!ids.length) { nav(`/summary/${setId}`); return; }
    const nextId = ids.find(x=>x.index === i+1)?.quiz_id;
    if (nextId) nav(`/quiz/${nextId}?set=${setId}&i=${i+1}&t=${t}`); else nav(`/summary/${setId}`);
  }

  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(quiz.quiz_set_id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  if (loading || !quiz) return <div className="text-gray-600">Loading quiz…</div>;

  return (
    <div className="bg-white shadow-xl rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-28"><ProgressBar value={pct} total={t} /></div>
          <div className="text-sm text-gray-600">{i} of {t}</div>
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
        </div>
      </div>

      <h2 className="text-xl font-semibold mb-2" dangerouslySetInnerHTML={{ __html: quiz.sentence_target }} />
      <p className="text-gray-600 mb-6">{quiz.sentence_known_masked}</p>

      <div className="grid grid-cols-1 gap-3">
        {quiz.options_known.map((opt: string, idx: number) => {
          const isPicked = picked === idx;
          const isCorrect = correctIndex !== null && idx === correctIndex;
          const isWrongPick = correctIndex !== null && isPicked && !isCorrect;

          const cls = [
            "w-full text-left px-4 py-3 rounded-lg border transition",
            "disabled:opacity-60",
            isCorrect ? "bg-green-50 border-green-400" :
            isWrongPick ? "bg-red-50 border-red-400" :
            isPicked ? "bg-indigo-50 border-indigo-400" :
            "hover:bg-gray-50"
          ].join(" ");

          return (
            <button key={idx} className={cls} disabled={choicesDisabled && !isPicked} onClick={()=>choose(idx)}>
              <span className="font-mono mr-2">{String.fromCharCode(97+idx)})</span> {opt}
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
          <button onClick={next} className="px-5 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
            {i < t ? "Next" : "Finish"}
          </button>
        )}
      </div>
    </div>
  );
}
