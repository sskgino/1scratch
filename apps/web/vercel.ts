import { type VercelConfig } from '@vercel/config/v1'

export const config: VercelConfig = {
  framework: 'nextjs',
  buildCommand: 'pnpm --filter @1scratch/web build',
  installCommand: 'pnpm install --frozen-lockfile',
  // Sync workers run on a daily cadence to compact mutation logs.
  crons: [
    { path: '/api/cron/compact-mutations', schedule: '0 4 * * *' },
  ],
}
