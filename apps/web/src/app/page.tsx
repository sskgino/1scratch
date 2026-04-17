import Link from 'next/link'

export default function HomePage() {
  return (
    <main className="canvas-grid paper-grain min-h-screen relative overflow-hidden">
      {/* Top draftsman's rule + metadata strip */}
      <header className="px-8 pt-6">
        <div className="rule rule-draw" />
        <div
          className="mt-3 flex justify-between text-[10px] tracking-[0.18em] uppercase fade-in"
          style={{ fontFamily: 'var(--font-jetbrains), monospace', color: 'var(--ink-soft)', animationDelay: '600ms' }}
        >
          <span>1Scratch ─ Infinite Canvas Workspace</span>
          <span className="hidden sm:inline">Sheet 01 / Rev 0.1 ─ Charleston SC ─ MMXXVI</span>
          <span className="sm:hidden">MMXXVI</span>
        </div>
      </header>

      {/* Main composition — asymmetric: brand left, sample memos right */}
      <section className="relative grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-8 px-8 pt-20 pb-32 max-w-[1400px] mx-auto">
        {/* LEFT — wordmark + tagline + auth CTA */}
        <div className="relative">
          <div className="lift-in" style={{ animationDelay: '300ms' }}>
            <span className="stamp">Beta ── Drafting</span>
          </div>

          <h1
            className="lift-in mt-6 leading-[0.92] tracking-[-0.02em] text-[clamp(3.5rem,9vw,7.5rem)]"
            style={{
              fontFamily: 'var(--font-fraunces)',
              fontWeight: 380,
              fontVariationSettings: '"opsz" 144, "SOFT" 50',
              animationDelay: '500ms',
            }}
          >
            Think on
            <br />
            <em
              style={{
                fontStyle: 'italic',
                fontVariationSettings: '"opsz" 144, "SOFT" 100',
                color: 'var(--accent)',
              }}
            >
              an infinite
            </em>
            <br />
            canvas.
          </h1>

          <p
            className="lift-in mt-10 max-w-[36ch] text-lg leading-[1.55]"
            style={{ color: 'var(--ink-soft)', animationDelay: '750ms' }}
          >
            1Scratch is a workspace for prompts. Lay them out the way you'd
            spread papers on a desk — drag, group, branch. Bring your own keys.
            Talk to every major model from one room.
          </p>

          <div
            className="lift-in mt-12 flex items-center gap-6"
            style={{ animationDelay: '900ms' }}
          >
            <Link
              href="/sign-up"
              className="group relative inline-flex items-center gap-3 px-7 py-4 text-base"
              style={{
                background: 'var(--ink)',
                color: 'var(--paper)',
                fontFamily: 'var(--font-jetbrains)',
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                fontSize: '12px',
              }}
            >
              <span>Begin a workspace</span>
              <span
                className="inline-block transition-transform group-hover:translate-x-1"
                style={{ color: 'var(--accent)' }}
              >
                ──&gt;
              </span>
            </Link>
            <Link
              href="/sign-in"
              className="text-sm underline decoration-1 underline-offset-4"
              style={{
                fontFamily: 'var(--font-jetbrains)',
                letterSpacing: '0.04em',
                color: 'var(--ink-soft)',
              }}
            >
              already drafting? sign in
            </Link>
          </div>

          {/* Specs row — feels like a parts list on an engineering drawing */}
          <dl
            className="fade-in mt-20 grid grid-cols-3 gap-6 max-w-md"
            style={{ animationDelay: '1100ms' }}
          >
            {[
              ['§01', 'Bring own keys', 'Anthropic · OpenAI · Google · 7 more'],
              ['§02', 'Free tier', '$2/day on us, no card'],
              ['§03', 'Cross-device', 'Desktop + iOS + Android (Q3)'],
            ].map(([n, h, b]) => (
              <div key={n} className="border-t pt-3" style={{ borderColor: 'var(--rule)' }}>
                <div className="marginalia mb-2">{n}</div>
                <div
                  className="text-[15px] leading-tight"
                  style={{ fontFamily: 'var(--font-fraunces)', fontWeight: 500 }}
                >
                  {h}
                </div>
                <div className="mt-1 text-[11px]" style={{ color: 'var(--ink-soft)' }}>
                  {b}
                </div>
              </div>
            ))}
          </dl>
        </div>

        {/* RIGHT — pinned memo cards arranged on the canvas */}
        <div className="relative h-[640px] hidden lg:block">
          <Memo
            x={40}
            y={20}
            rotate={-2.5}
            delay={1000}
            label="card.001"
            model="claude-opus-4"
            prompt="Draft a working theory for why customers churn between week 2 and 3."
            response="Likely cause: the activation goal we measure (3 canvases) doesn't match the actual aha moment, which seems to be the first multi-model comparison…"
          />
          <Memo
            x={260}
            y={170}
            rotate={1.8}
            delay={1200}
            label="card.014"
            model="gpt-5"
            prompt="What's the elasticity argument for $10/mo vs. $12?"
            response="At $10 you sit under the impulse-buy threshold for solo devs; at $12 you cross into 'I'll think about it.' Volume × LTV favors $10 unless conversion >…"
          />
          <Memo
            x={70}
            y={360}
            rotate={-0.5}
            delay={1400}
            label="card.027"
            model="gemini-2.5-pro"
            prompt="Critique the previous answer."
            response="The elasticity claim is asserted, not measured. To trust it we'd need either a price test or an analog from a comparable indie SaaS in the…"
          />
          <Memo
            x={310}
            y={420}
            rotate={2.2}
            delay={1600}
            label="card.031"
            model="local · gemma-3"
            prompt="Summarize the thread for the team standup."
            response="Three takes on $10 vs $12. Claude argues impulse-buy; GPT-5 wants a price test; Gemini wants a comparable. Recommend: ship $10, A/B at $12 in 4 weeks."
          />

          {/* Annotation arrow pointing to the cluster */}
          <svg
            className="absolute pointer-events-none fade-in"
            style={{ left: -40, top: 280, animationDelay: '1800ms' }}
            width="120"
            height="80"
            viewBox="0 0 120 80"
            fill="none"
          >
            <path
              d="M5 40 Q 50 10, 100 35"
              stroke="var(--accent)"
              strokeWidth="1"
              fill="none"
              strokeDasharray="3 3"
            />
            <path d="M95 30 L 102 36 L 96 41" stroke="var(--accent)" strokeWidth="1" fill="none" />
          </svg>
          <div
            className="absolute fade-in marginalia"
            style={{
              left: -110,
              top: 320,
              transform: 'rotate(-8deg)',
              animationDelay: '1900ms',
              color: 'var(--accent)',
              maxWidth: 110,
            }}
          >
            one prompt,<br/>three models,<br/>one workspace
          </div>
        </div>
      </section>

      {/* Bottom rule + status line */}
      <footer className="px-8 pb-6 absolute inset-x-0 bottom-0">
        <div className="rule rule-draw" style={{ animationDelay: '400ms' }} />
        <div
          className="mt-3 flex justify-between text-[10px] tracking-[0.18em] uppercase fade-in"
          style={{ fontFamily: 'var(--font-jetbrains)', color: 'var(--ink-soft)', animationDelay: '700ms' }}
        >
          <span>© 2026 1Scratch LLC</span>
          <span className="flex items-center gap-2">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full animate-pulse"
              style={{ background: 'var(--accent)' }}
            />
            All systems nominal
          </span>
        </div>
      </footer>
    </main>
  )
}

function Memo({
  x, y, rotate, delay, label, model, prompt, response,
}: {
  x: number; y: number; rotate: number; delay: number;
  label: string; model: string; prompt: string; response: string;
}) {
  return (
    <article
      className="memo absolute lift-in p-4 w-[260px]"
      style={{
        left: x,
        top: y,
        transform: `rotate(${rotate}deg)`,
        animationDelay: `${delay}ms`,
      }}
    >
      <header className="flex items-center justify-between border-b pb-1.5" style={{ borderColor: 'var(--rule)' }}>
        <span className="marginalia">{label}</span>
        <span
          className="text-[9px] px-1.5 py-0.5"
          style={{
            fontFamily: 'var(--font-jetbrains)',
            background: 'var(--paper-deep)',
            color: 'var(--ink-soft)',
            letterSpacing: '0.05em',
          }}
        >
          {model}
        </span>
      </header>
      <p
        className="mt-2.5 text-[13px] leading-snug"
        style={{ fontFamily: 'var(--font-fraunces)', fontWeight: 500 }}
      >
        {prompt}
      </p>
      <p
        className="mt-2 text-[11px] leading-relaxed"
        style={{ color: 'var(--ink-soft)' }}
      >
        {response}
      </p>
    </article>
  )
}
