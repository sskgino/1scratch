import { type VercelConfig } from '@vercel/config/v1'

export const config: VercelConfig = {
  framework: 'nextjs',
  buildCommand: 'pnpm --filter @1scratch/web build',
  installCommand: 'pnpm install --frozen-lockfile',
  crons: [
    // Purge account deletion requests whose 24-hr cool-off has elapsed.
    // Runs hourly so the execution lag stays under an hour past the window.
    { path: '/api/cron/purge-deletions', schedule: '0 * * * *' },
  ],
}
