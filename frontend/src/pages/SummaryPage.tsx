// frontend/src/pages/SummaryPage.tsx
import { useEffect, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { getSummary } from "../lib/api";

function Card({
  label,
  value,
  right,
}: {
  label: string;
  value: string | number;
  right?: React.ReactNode;
}) {
  return (
    <div className="h-full rounded-xl border bg-white shadow-sm p-4 flex flex-col justify-between">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm text-gray-600">{label}</div>
        {right}
      </div>
      <div className="mt-2 text-2xl font-semibold leading-tight break-words">
        {value}
      </div>
    </div>
  );
}

function Chip({
  text,
  tone = "gray",
  title,
}: {
  text: string;
  tone?: "green" | "yellow" | "red" | "gray";
  title?: string;
}) {
  const tones: Record<string, string> = {
    green: "bg-green-50 text-green-700 border-green-200",
    yellow: "bg-yellow-50 text-yellow-700 border-yellow-200",
    red: "bg-red-50 text-red-700 border-red-200",
    gray: "bg-gray-50 text-gray-700 border-gray-200",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full border whitespace-nowrap ${tones[tone]}`}
      title={title}
    >
      {text}
    </span>
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
      } catch {
        if (m) setErr("Failed to load summary.");
      }
    })();
    return () => {
      m = false;
    };
  }, [setId, attempt]);

  if (err) return <div className="text-red-600">{err}</div>;
  if (!data) return <div className="text-gray-600">Loading summary…</div>;

  const { counts, overall_accuracy, difficulty } = data;
  const pct = Math.round((overall_accuracy || 0) * 100);
  const diff = difficulty || { Easy: 0, Moderate: 0, Hard: 0, Unknown: 0 };

  return (
    <div className="bg-white shadow-xl rounded-2xl p-6 space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Feedback</h1>
        <p className="text-gray-600">
          Overall accuracy, difficulty, and per-word results.
        </p>
      </div>

      {/* Row 1: Stats (exact same grid as difficulty row) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card label="Accuracy" value={`${pct}%`} />
        <Card label="Correct" value={counts?.correct ?? 0} />
        <Card
          label="Incorrect / Skipped"
          value={`${counts?.incorrect ?? 0} / ${counts?.skipped ?? 0}`}
        />
      </div>

      {/* Row 2: Difficulty (same grid → widths match) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card
          label="Easy"
          value={diff.Easy || 0}
        />
        <Card
          label="Moderate"
          value={diff.Moderate || 0}
        />
        <Card
          label="Hard"
          value={diff.Hard || 0}
        />
        {/* If you also want Unknown, uncomment and change grid to md:grid-cols-4 for both rows
        <Card
          label="Difficulty"
          value={diff.Unknown || 0}
          right={<Chip text="Unscored" tone="gray" />}
        />
        */}
      </div>

      {/* Results */}
      <div className="space-y-4">
        {/* Mobile cards */}
        <div className="grid grid-cols-1 gap-3 md:hidden">
          {data.items.map((it: any) => (
            <div key={it.quiz_id} className="rounded-xl border p-4 bg-white">
              <div className="text-sm text-gray-500">Word</div>
              <div className="font-medium break-words whitespace-normal hyphens-auto leading-relaxed">
                {it.word}
              </div>

              <div className="mt-3 flex items-center justify-between">
                <span className="text-sm text-gray-500">Difficulty</span>
                {it.difficulty_label ? (
                  <Chip
                    text={it.difficulty_label}
                    tone={
                      it.difficulty_label === "Easy"
                        ? "green"
                        : it.difficulty_label === "Moderate"
                        ? "yellow"
                        : "red"
                    }
                    title={
                      it.difficulty_score != null
                        ? `Score ${it.difficulty_score}/10`
                        : undefined
                    }
                  />
                ) : (
                  <span className="text-sm text-gray-500">—</span>
                )}
              </div>

              <div className="mt-2 flex items-center justify-between">
                <span className="text-sm text-gray-500">Result</span>
                <span className="font-medium">
                  {it.result === "correct"
                    ? "✅ Correct"
                    : it.result === "incorrect"
                    ? "❌ Incorrect"
                    : "⏭ Skipped"}
                </span>
              </div>

              <div className="mt-2 flex items-center justify-between">
                <span className="text-sm text-gray-500">Time</span>
                <span className="font-medium">{it.formatted_time}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block">
          <div className="overflow-x-auto rounded-lg border">
            <table className="min-w-full table-auto border-collapse bg-white">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-3 border">Word</th>
                  <th className="text-left p-3 border">Difficulty</th>
                  <th className="text-left p-3 border">Result</th>
                  <th className="text-left p-3 border">Time</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((it: any) => (
                  <tr key={it.quiz_id} className="odd:bg-white even:bg-gray-50 align-top">
                    <td className="p-3 border break-words whitespace-normal hyphens-auto leading-relaxed">
                      {it.word}
                    </td>
                    <td className="p-3 border">
                      {it.difficulty_label ? (
                        <Chip
                          text={it.difficulty_label}
                          tone={
                            it.difficulty_label === "Easy"
                              ? "green"
                              : it.difficulty_label === "Moderate"
                              ? "yellow"
                              : "red"
                          }
                          title={
                            it.difficulty_score != null
                              ? `Score ${it.difficulty_score}/10`
                              : undefined
                          }
                        />
                      ) : (
                        "—"
                      )}
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
        </div>
      </div>

      {/* Footer actions */}
      <div className="pt-2">
        <Link to="/" className="inline-flex px-4 py-2 rounded-lg border hover:bg-gray-50">
          Generate another
        </Link>
      </div>
    </div>
  );
}
