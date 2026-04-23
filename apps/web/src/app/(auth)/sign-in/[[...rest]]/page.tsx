import Link from 'next/link'
import { cookies } from 'next/headers'
import { SignIn } from '@clerk/nextjs'
import { clerkAppearance } from '@/lib/clerk-appearance'

const RETURN_RE = /^(1scratch:\/\/auth\/done|https:\/\/app\.1scratch\.ai\/m\/auth\/done)(\?|$)/

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ return?: string }>
}) {
  const params = await searchParams
  const ret = params.return
  const jar = await cookies()
  const cookieReturn = jar.get('mobile_return')?.value
  const mobile = !!((ret && RETURN_RE.test(ret)) || (cookieReturn && RETURN_RE.test(cookieReturn)))
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
        forceRedirectUrl={mobile ? '/mobile/handoff' : '/app'}
        signUpForceRedirectUrl={mobile ? '/mobile/handoff' : '/app'}
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
