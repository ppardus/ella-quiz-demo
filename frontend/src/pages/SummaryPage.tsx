import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { getSummary } from "../lib/api";

export default function SummaryPage() {
  const { setId } = useParams();
  const [data, setData] = useState<any>(null);
  useEffect(() => { let m=true; getSummary(setId!).then(d=>{ if(m) setData(d); }); return ()=>{ m=false; }; }, [setId]);
  if (!data) return <div className="text-gray-600">Loading summary…</div>;
  const { counts, overall_accuracy } = data; const pct = Math.round((overall_accuracy || 0) * 100);

  return (
    <div className="bg-white shadow-xl rounded-2xl p-6">
      <h1 className="text-2xl font-semibold mb-1">Feedback</h1>
      <p className="text-gray-600 mb-6">Overall accuracy and per-word results.</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card label="Accuracy" value={`${pct}%`} />
        <Card label="Correct" value={counts.correct} />
        <Card label="Incorrect / Skipped" value={`${counts.incorrect} / ${counts.skipped}`} />
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full border rounded-lg">
          <thead><tr className="bg-gray-50"><th className="text-left p-3 border">Word</th><th className="text-left p-3 border">Result</th></tr></thead>
          <tbody>
            {data.items.map((it: any) => (
              <tr key={it.quiz_id} className="odd:bg-white even:bg-gray-50">
                <td className="p-3 border">{it.word}</td>
                <td className="p-3 border">{it.result === "correct" ? "✅ Correct" : it.result === "incorrect" ? "❌ Incorrect" : "⏭ Skipped"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 flex gap-3">
        <Link to="/" className="px-4 py-2 rounded-lg border">Generate another</Link>
      </div>
    </div>
  );
}
function Card({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl border p-4 bg-gradient-to-br from-white to-gray-50">
    <div className="text-sm text-gray-600">{label}</div>
    <div className="text-2xl font-semibold">{value}</div>
  </div>;
}
