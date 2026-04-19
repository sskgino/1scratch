// Client-side instrumentation: Vercel BotID (invisible bot challenge)
// and Sentry error/perf capture. Both run in every browser session.

import { initBotId } from 'botid/client/core'
import * as Sentry from '@sentry/nextjs'

initBotId({
  protect: [
    { path: '/api/ai/stream', method: 'POST' },
    { path: '/api/providers', method: 'POST' },
    { path: '/sign-in', method: 'POST' },
    { path: '/sign-up', method: 'POST' },
  ],
})

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  enabled: process.env.NODE_ENV === 'production',
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
