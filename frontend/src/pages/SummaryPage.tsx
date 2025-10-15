import { useEffect, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { getSummary } from "../lib/api";

function Card({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border p-4 bg-gradient-to-br from-white to-gray-50">
      <div className="text-sm text-gray-600">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}

export default function SummaryPage() {
  const { setId } = useParams();
  const [sp] = useSearchParams();
  const attempt = sp.get("attempt") || undefined;

  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let m = true;
    (async () => {
      try {
        const d = await getSummary(setId!, attempt);
        if (m) setData(d);
      } catch (e: any) {
        if (m) setErr("Failed to load summary.");
      }
    })();
    return () => { m = false; };
  }, [setId, attempt]);

  if (err) return <div className="text-red-600">{err}</div>;
  if (!data) return <div className="text-gray-600">Loading summary…</div>;

  const { counts, overall_accuracy, difficulty } = data;
  const pct = Math.round((overall_accuracy || 0) * 100);
  const diff = difficulty || { Easy: 0, Moderate: 0, Hard: 0, Unknown: 0 };

  return (
    <div className="bg-white shadow-xl rounded-2xl p-6">
      <h1 className="text-2xl font-semibold mb-1">Feedback</h1>
      <p className="text-gray-600 mb-6">Overall accuracy, difficulty, and per-word results.</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card label="Accuracy" value={`${pct}%`} />
        <Card label="Correct" value={counts?.correct ?? 0} />
        <Card label="Incorrect / Skipped" value={`${counts?.incorrect ?? 0} / ${counts?.skipped ?? 0}`} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card label="Easy" value={diff.Easy} />
        <Card label="Moderate" value={diff.Moderate} />
        <Card label="Hard" value={diff.Hard} />
        {diff.Unknown ? <Card label="Unscored" value={diff.Unknown} /> : <div />}
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full border rounded-lg">
          <thead>
            <tr className="bg-gray-50">
              <th className="text-left p-3 border">Word</th>
              <th className="text-left p-3 border">Difficulty</th>
              <th className="text-left p-3 border">Result</th>
              <th className="text-left p-3 border">Time</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((it: any) => (
              <tr key={it.quiz_id} className="odd:bg-white even:bg-gray-50">
                <td className="p-3 border">{it.word}</td>
                <td className="p-3 border">
                  {it.difficulty_label ? (
                    <span
                      className={
                        "inline-block px-2 py-0.5 text-xs rounded-full border " +
                        (it.difficulty_label === "Easy"
                          ? "bg-green-50 text-green-700 border-green-200"
                          : it.difficulty_label === "Moderate"
                          ? "bg-yellow-50 text-yellow-700 border-yellow-200"
                          : "bg-red-50 text-red-700 border-red-200")
                      }
                      title={it.difficulty_score != null ? `Score ${it.difficulty_score}/10` : undefined}
                    >
                      {it.difficulty_label}
                    </span>
                  ) : "—"}
                </td>
                <td className="p-3 border">
                  {it.result === "correct"
                    ? "✅ Correct"
                    : it.result === "incorrect"
                    ? "❌ Incorrect"
                    : "⏭ Skipped"}
                </td>
                <td className="p-3 border">{it.formatted_time}</td>
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
