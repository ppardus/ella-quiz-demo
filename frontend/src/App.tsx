import { Outlet, Link } from "react-router-dom";
export default function App() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-100 via-white to-purple-100">
      <header className="px-6 py-4 border-b bg-white/70 backdrop-blur">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link to="/" className="font-semibold text-indigo-700">Ella Quiz Demo</Link>
          <a href={import.meta.env.VITE_API_BASE} className="text-sm text-gray-500" target="_blank">API</a>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-8"><Outlet /></main>
    </div>
  );
}
