import path from 'node:path'
import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // Allow importing from workspace packages without pre-build.
  transpilePackages: ['@1scratch/types', '@1scratch/sync-proto'],
  turbopack: {
    root: path.resolve(__dirname, '../..'),
  },
}

export default config
