import path from 'node:path'
import type { NextConfig } from 'next'
import { withBotId } from 'botid/next/config'
import { withSentryConfig } from '@sentry/nextjs'
import { withWorkflow } from 'workflow/next'

const config: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // Allow importing from workspace packages without pre-build.
  transpilePackages: ['@1scratch/types', '@1scratch/sync-proto'],
  turbopack: {
    root: path.resolve(__dirname, '../..'),
  },
}

export default withSentryConfig(withBotId(withWorkflow(config)), {
  org: '1scratch-llc',
  project: 'web',
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  disableLogger: true,
})
