import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { listConnections } from '@/lib/providers'
import { listSlots } from '@/lib/model-slots'
import { checkCap } from '@/lib/spend-cap'
import { MODEL_REGISTRY } from '@/lib/model-registry'
import { Workbench } from './Workbench'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function AppPage() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const [connections, slots, cap] = await Promise.all([
    listConnections(userId),
    listSlots(userId),
    checkCap(userId),
  ])

  const populatedSlots = slots.filter((s) => s.modelId && s.providerConnectionId)
  const registry = Object.values(MODEL_REGISTRY).map((m) => ({
    id: m.id,
    displayName: m.displayName,
    displayAbbr: m.displayAbbr,
  }))

  return (
    <Workbench
      populatedSlots={populatedSlots}
      connections={connections}
      registry={registry}
      initialCapUsedCents={cap.usedCents}
      capCents={cap.capCents}
    />
  )
}
