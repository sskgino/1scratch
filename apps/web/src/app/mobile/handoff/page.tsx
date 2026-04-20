import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import MobileHandoffClient from './MobileHandoffClient'

export const dynamic = 'force-dynamic'

const RETURN_RE = /^1scratch:\/\/auth\/done(\?|$)/

export default async function MobileHandoffPage() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')
  const jar = await cookies()
  const ret = jar.get('mobile_return')?.value
  if (!ret || !RETURN_RE.test(ret)) redirect('/app')
  const deviceId = jar.get('mobile_device_id')?.value
  const deviceLabel = jar.get('mobile_device_label')?.value
  jar.delete('mobile_return')
  jar.delete('mobile_device_id')
  jar.delete('mobile_device_label')
  return <MobileHandoffClient returnUrl={ret} deviceId={deviceId ?? null} deviceLabel={deviceLabel ?? null} />
}
