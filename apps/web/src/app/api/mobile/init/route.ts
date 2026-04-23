import { NextResponse, type NextRequest } from 'next/server'

const RETURN_RE = /^(1scratch:\/\/auth\/done|https:\/\/app\.1scratch\.ai\/m\/auth\/done)(\?|$)/

export async function GET(req: NextRequest) {
  const u = new URL(req.url)
  const ret = u.searchParams.get('return') ?? ''
  const deviceId = u.searchParams.get('device_id')
  const deviceLabel = u.searchParams.get('device_label')
  if (!RETURN_RE.test(ret)) {
    return NextResponse.redirect(new URL('/sign-in', req.url))
  }
  const signIn = new URL('/sign-in', req.url)
  signIn.searchParams.set('return', ret)
  if (deviceId) signIn.searchParams.set('device_id', deviceId)
  if (deviceLabel) signIn.searchParams.set('device_label', deviceLabel)
  const res = NextResponse.redirect(signIn)
  const opts = { httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge: 600 }
  res.cookies.set('mobile_return', ret, opts)
  if (deviceId) res.cookies.set('mobile_device_id', deviceId, opts)
  if (deviceLabel) res.cookies.set('mobile_device_label', deviceLabel, opts)
  return res
}
