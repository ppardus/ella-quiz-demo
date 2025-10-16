import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { generateQuizzes } from "../lib/api";

const SAMPLE = `decisione: decision
invito/ invitation
domanda; question
conversazione -> conversation
"tempo","time"
casa: house
strada/ street
porta; door
libro -> book
scuola: school
`;

export default function GeneratePage() {
  const nav = useNavigate();
  const [targetLang, setTargetLang] = useState("Italian");
  const [knownLang, setKnownLang] = useState("English");
  const [level, setLevel] = useState("B1");
  const [text, setText] = useState(SAMPLE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onGenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await generateQuizzes({
        target_language: targetLang,
        known_language: knownLang,
        level,
        options: { num_options: 4, shuffle: true },
        // send as raw_text so backend parses flexibly
        // @ts-ignore
        raw_text: text,
      } as any);
      const first = res.items[0]?.quiz_id;
      if (first) nav(`/quiz/${first}?set=${res.quiz_set_id}&i=1&t=${res.count}`);
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message || "Failed to generate");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white shadow-xl rounded-2xl p-6">
      <h1 className="text-2xl font-semibold mb-1">Generate Vocabulary Quizzes</h1>
      <p className="text-gray-500 mb-4">
        Paste words like <code>term: translation</code>, <code>term/translation</code>,
        <code>term;translation</code>, <code>term -&gt; translation</code>, CSV/TSV, or one per line.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <div>
          <label className="text-sm font-medium">Target language</label>
          <input className="mt-1 w-full border rounded-lg px-3 py-2"
                 value={targetLang} onChange={(e) => setTargetLang(e.target.value)} />
        </div>
        <div>
          <label className="text-sm font-medium">Known language</label>
          <input className="mt-1 w-full border rounded-lg px-3 py-2"
                 value={knownLang} onChange={(e) => setKnownLang(e.target.value)} />
        </div>
        <div>
          <label className="text-sm font-medium">Learner level</label>
          <select className="mt-1 w-full border rounded-lg px-3 py-2"
                  value={level} onChange={(e) => setLevel(e.target.value)}>
            {["A1","A2","B1","B2","C1","C2"].map(L => <option key={L}>{L}</option>)}
          </select>
        </div>
      </div>

      <label className="text-sm font-medium">Words</label>
      <textarea className="mt-1 w-full border rounded-lg px-3 py-3 font-mono min-h-[180px]"
                value={text} onChange={(e) => setText(e.target.value)} />
      {error && <div className="mt-3 text-sm text-red-600">{error}</div>}

      <div className="mt-5 flex gap-3">
        <button onClick={onGenerate} disabled={loading}
                className="px-5 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60">
          {loading ? "Generating..." : "Generate Quizzes"}
        </button>
        <button onClick={() => setText(SAMPLE)} className="px-4 py-2 rounded-lg border">
          Use Sample
        </button>
      </div>
    </div>
  );
}
