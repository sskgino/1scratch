import Link from 'next/link'
import { SignUp } from '@clerk/nextjs'
import { clerkAppearance } from '@/lib/clerk-appearance'

export default function SignUpPage() {
  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <span className="stamp">Begin ─ §02.B</span>
        <span
          className="text-[10px] tracking-[0.14em] uppercase"
          style={{ fontFamily: 'var(--font-jetbrains)', color: 'var(--ink-soft)' }}
        >
          Free · no card
        </span>
      </div>

      <SignUp
        appearance={clerkAppearance}
        path="/sign-up"
        routing="path"
        signInUrl="/sign-in"
        forceRedirectUrl="/app"
      />

      <p
        className="mt-8 text-center text-[12px]"
        style={{ fontFamily: 'var(--font-jetbrains)', color: 'var(--ink-soft)' }}
      >
        already drafting?{' '}
        <Link
          href="/sign-in"
          className="underline decoration-1 underline-offset-4"
          style={{ color: 'var(--accent)' }}
        >
          sign in
        </Link>
      </p>
    </>
  )
}
