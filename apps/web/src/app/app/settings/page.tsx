// Settings → Security, Import, Danger zone.
// Server component fetches the initial data; a client island handles the
// interactive bits (cancel deletion, request deletion, import upload).

import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { listEvents } from '@/lib/audit-events'
import { getActiveRequest } from '@/lib/account-deletion'
import { SettingsPanel } from './SettingsPanel'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const [events, activeDeletion] = await Promise.all([
    listEvents(userId, 100),
    getActiveRequest(userId),
  ])

  return (
    <SettingsPanel initialEvents={events} initialDeletion={activeDeletion} />
  )
}
