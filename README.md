# 1Scratch

Infinite-canvas LLM workspace. Desktop + mobile + web, BYOK, multi-provider.

See [PLAN.md](./PLAN.md) for the full architecture and roadmap.

## Workspace layout

```
.
├── apps/
│   ├── client/   # Tauri 2 desktop + mobile (React 19 + Vite + Tailwind v4)
│   └── web/      # Next.js 16 backend + landing — app.1scratch.ai
├── packages/
│   ├── types/        # Shared TypeScript types (Card, Tab, Section, ...)
│   └── sync-proto/   # Sync protocol: HLC, Mutation, push/pull messages
└── PLAN.md
```

## Local setup

Requires Node 24+ and pnpm 10+.

```bash
pnpm install
pnpm dev          # runs all dev servers in parallel
pnpm typecheck    # checks every package
```

Run individual apps:

```bash
pnpm --filter @1scratch/web dev
pnpm --filter @1scratch/client dev
```

## Phase status

Phase 1 (Backend Foundation, W0–W3) — in progress. See PLAN.md §10.
