import { Outlet, Link } from "react-router-dom";

export default function App() {
  return (
    <div className="min-h-screen bg-background text-[#333]">
      {/* Header: centered capsule brand, subtle border, sticky on mobile */}
      <header className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-gray-200">
        <div className="max-w-md mx-auto px-4 py-3 relative flex items-center justify-center">
          {/* Left spacer to keep title centered even with the API link on the right */}
          <div className="absolute left-4 top-1/2 -translate-y-1/2">
            <Link
              to="/"
              aria-label="Home"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100"
            >
              {/* simple chevron/back icon look (optional) */}
              <span className="sr-only">Home</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Link>
          </div>

          {/* Brand capsule */}
          <span className="px-4 py-1.5 rounded-full text-sm font-semibold bg-primary/15 text-primary shadow-soft select-none">
            Ella
          </span>
        </div>
      </header>

      {/* Main content area: narrow, phone-like width; comfy padding */}
      <main className="max-w-md mx-auto px-4 py-4 md:py-6">
        <Outlet />
        {/* Safe-area pad for iOS when you add a fixed bottom bar elsewhere */}
        <div className="pb-[env(safe-area-inset-bottom)]" />
      </main>
    </div>
  );
}
