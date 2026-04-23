import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { applyCorsHeaders } from '@/lib/cors-mobile'

// API routes self-gate via resolveAuthedUserId (bearer OR Clerk session).
// Only web paths that require a Clerk session stay in the proxy matcher.
const isProtectedRoute = createRouteMatcher(['/app(.*)', '/mobile(.*)'])

// Tauri WebView fetches API cross-origin; without CORS the WebView blocks the preflight.
const isMobileApiRoute = createRouteMatcher(['/api/mobile/(.*)', '/api/sync/(.*)'])

export default clerkMiddleware(async (auth, req) => {
  const origin = req.headers.get('origin')
  const isCors = isMobileApiRoute(req)
  if (isCors && req.method === 'OPTIONS') {
    const res = new NextResponse(null, { status: 204 })
    applyCorsHeaders(res.headers, origin)
    return res
  }
  if (isProtectedRoute(req)) {
    await auth.protect()
  }
  if (!isCors) return
  const res = NextResponse.next()
  applyCorsHeaders(res.headers, origin)
  return res
})

export const config = {
  matcher: [
    // Exclude _next internals, static assets, and workflow internals.
    '/((?!_next|\\.well-known/workflow/|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
