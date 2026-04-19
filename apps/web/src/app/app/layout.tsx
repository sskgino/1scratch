import Link from 'next/link'
import { UserButton } from '@clerk/nextjs'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="canvas-grid paper-grain min-h-screen flex flex-col">
      <header className="px-8 pt-6">
        <div className="rule rule-draw" />
        <div
          className="mt-3 flex justify-between items-center text-[10px] tracking-[0.18em] uppercase fade-in"
          style={{ fontFamily: 'var(--font-jetbrains)', color: 'var(--ink-soft)' }}
        >
          <div className="flex items-center gap-6">
            <Link href="/" className="hover:text-[color:var(--accent)] transition-colors">
              ── 1Scratch
            </Link>
            <Link href="/app" className="hover:text-[color:var(--accent)] transition-colors">
              workbench
            </Link>
            <Link href="/app/models" className="hover:text-[color:var(--accent)] transition-colors">
              models
            </Link>
            <Link href="/app/settings" className="hover:text-[color:var(--accent)] transition-colors">
              settings
            </Link>
          </div>
          <UserButton
            appearance={{
              elements: { avatarBox: 'h-6 w-6 border border-[color:var(--rule)]' },
            }}
          />
        </div>
      </header>
      <div className="flex-1 px-8 pb-8 pt-12">{children}</div>
    </main>
  )
}
