# @1scratch/web

Next.js 16 backend for 1Scratch — auth, sync, AI proxy, billing webhooks.

## Local setup

```bash
cp .env.example .env.local
# fill in DATABASE_URL, CLERK_*, AWS_KMS_KEY_ID, etc.
pnpm --filter @1scratch/web dev
```

## Routes

- `/` — placeholder landing
- `/sign-in`, `/sign-up` — Clerk auth pages (TBD)
- `/api/health` — liveness probe
- `/api/sync/push`, `/api/sync/pull` — mutation log endpoints (TBD)
- `/api/ai/chat` — streaming AI proxy via Vercel AI Gateway (TBD)
- `/api/providers/*` — manage BYOK + OAuth provider connections (TBD)
- `/api/billing/paddle` — Paddle webhook (TBD)
