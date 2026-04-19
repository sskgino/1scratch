import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { listConnections } from '@/lib/providers'
import { listSlots } from '@/lib/model-slots'
import { MODEL_REGISTRY } from '@/lib/model-registry'
import { ModelsPage } from './ModelsPage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function Page() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const [connections, slots] = await Promise.all([
    listConnections(userId),
    listSlots(userId),
  ])

  const registry = Object.values(MODEL_REGISTRY).map((m) => ({
    id: m.id,
    provider: m.provider,
    displayName: m.displayName,
    displayAbbr: m.displayAbbr,
  }))

  return (
    <ModelsPage
      initialConnections={connections}
      initialSlots={slots}
      registry={registry}
    />
  )
}
