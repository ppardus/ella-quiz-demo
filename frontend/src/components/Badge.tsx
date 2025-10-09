export default function Badge({ children }: { children: React.ReactNode }) {
  return <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">{children}</span>;
}
