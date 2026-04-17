import Link from 'next/link'
import { SignIn } from '@clerk/nextjs'
import { clerkAppearance } from '@/lib/clerk-appearance'

export default function SignInPage() {
  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <span className="stamp">Sign-in ─ §02.A</span>
        <span
          className="text-[10px] tracking-[0.14em] uppercase"
          style={{ fontFamily: 'var(--font-jetbrains)', color: 'var(--ink-soft)' }}
        >
          Welcome back
        </span>
      </div>

      <SignIn
        appearance={clerkAppearance}
        path="/sign-in"
        routing="path"
        signUpUrl="/sign-up"
        forceRedirectUrl="/app"
      />

      <p
        className="mt-8 text-center text-[12px]"
        style={{ fontFamily: 'var(--font-jetbrains)', color: 'var(--ink-soft)' }}
      >
        new here?{' '}
        <Link
          href="/sign-up"
          className="underline decoration-1 underline-offset-4"
          style={{ color: 'var(--accent)' }}
        >
          begin a workspace ──&gt;
        </Link>
      </p>
    </>
  )
}
