import Link from 'next/link'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="canvas-grid paper-grain min-h-screen flex flex-col">
      <header className="px-8 pt-6">
        <div className="rule rule-draw" />
        <div
          className="mt-3 flex justify-between text-[10px] tracking-[0.18em] uppercase fade-in"
          style={{ fontFamily: 'var(--font-jetbrains)', color: 'var(--ink-soft)' }}
        >
          <Link href="/" className="hover:text-[color:var(--accent)] transition-colors">
            ── 1Scratch
          </Link>
          <span>Authentication ─ Sheet 02</span>
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-md lift-in" style={{ animationDelay: '200ms' }}>
          {children}
        </div>
      </div>

      <footer className="px-8 pb-6">
        <div className="rule" />
        <div
          className="mt-3 flex justify-between text-[10px] tracking-[0.18em] uppercase"
          style={{ fontFamily: 'var(--font-jetbrains)', color: 'var(--ink-soft)' }}
        >
          <span>© 2026 1Scratch LLC</span>
          <span>support@1scratch.ai</span>
        </div>
      </footer>
    </main>
  )
}
