// Desktop-side Clerk JWT retrieval.
//
// Phase 2 proof-of-life: read a token from `VITE_DEV_CLERK_TOKEN` if set (local
// dev), otherwise throw. Proper Clerk sign-in on desktop lands later in Phase 2
// step 1 (client swap is already in the web workbench; desktop Clerk session
// integration coordinates separately).
export async function getAuthToken(): Promise<string> {
  const dev = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_DEV_CLERK_TOKEN
  if (dev) return dev
  throw new Error('No auth token configured — set VITE_DEV_CLERK_TOKEN or wire Clerk session')
}

export function apiBaseUrl(): string {
  const url = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_BASE_URL
  return url ?? 'https://app.1scratch.ai'
}
