export default function ProgressBar({ value, total }: { value: number; total: number }) {
  const pct = Math.max(0, Math.min(100, Math.round((value / Math.max(1,total)) * 100)));
  return <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
    <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500" style={{ width: `${pct}%` }} />
  </div>;
}
