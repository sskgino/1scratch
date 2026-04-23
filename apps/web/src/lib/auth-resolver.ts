import { auth } from '@clerk/nextjs/server'
import { verifyAccessToken } from './mobile-jwt'

const BEARER_RE = /^Bearer\s+(.+)$/i

export async function resolveAuthedUserId(req: Request): Promise<string | null> {
  const header = req.headers.get('authorization')
  const match = header?.match(BEARER_RE)
  if (match) {
    try {
      const claims = await verifyAccessToken(match[1]!.trim())
      return claims.sub
    } catch {
      return null
    }
  }
  const { userId } = await auth()
  return userId ?? null
}
