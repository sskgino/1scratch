import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

// API routes self-gate via resolveAuthedUserId (bearer OR Clerk session).
// Only web paths that require a Clerk session stay in the proxy matcher.
const isProtectedRoute = createRouteMatcher(['/app(.*)', '/mobile(.*)'])

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect()
  }
})

export const config = {
  matcher: [
    // Exclude _next internals, static assets, and workflow internals.
    '/((?!_next|\\.well-known/workflow/|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
