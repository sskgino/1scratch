import { Suspense } from 'react'
import AuthDoneBridgeClient from './AuthDoneBridgeClient'

export const dynamic = 'force-dynamic'

export default function AuthDoneBridgePage() {
  return (
    <Suspense fallback={null}>
      <AuthDoneBridgeClient />
    </Suspense>
  )
}
