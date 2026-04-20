import Link from 'next/link'
import { cookies } from 'next/headers'
import { SignIn } from '@clerk/nextjs'
import { clerkAppearance } from '@/lib/clerk-appearance'

const RETURN_RE = /^1scratch:\/\/auth\/done(\?|$)/

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ return?: string; device_id?: string; device_label?: string }>
}) {
  const params = await searchParams
  const ret = params.return
  let mobile = false
  if (ret && RETURN_RE.test(ret)) {
    const jar = await cookies()
    jar.set('mobile_return', ret, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    })
    if (params.device_id) {
      jar.set('mobile_device_id', params.device_id, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 600,
      })
    }
    if (params.device_label) {
      jar.set('mobile_device_label', params.device_label, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 600,
      })
    }
    mobile = true
  }
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
