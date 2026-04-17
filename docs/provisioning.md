# Phase 1 Provisioning Runbook

Executable checklist for PLAN.md Phase 1, bullet 1:
**"Provision: Vercel project, Neon DB (us-east + EU read replica), Clerk, Resend, Paddle (sandbox), AI Gateway, Sentry, Axiom."**

Also sets up AWS KMS (per PLAN.md §12 locked decision). All services are pay-as-you-go at free/dev tiers while we're in Phase 1 — keep an eye on the final checklist before Phase 4 launch.

---

## 0. Prereqs

- [ ] Vercel account exists, logged into [vercel.com/dashboard](https://vercel.com/dashboard) under an org owned by **1Scratch LLC** (not a personal account — billing + team seats live here).
- [ ] Upgrade CLI: `pnpm add -g vercel@latest` (current installed is 50.42.0; 51.5.x is needed for `vercel env pull` with linked Marketplace vars).
- [ ] `vercel login` — opens browser.
- [ ] Domain `1scratch.ai` is owned and nameservers point at Vercel (or ready to, after Step 1).
- [ ] A transactional mailbox exists at `support@1scratch.ai` with SPF/DKIM/DMARC configured. (See Step 4 — Resend can own the DKIM/SPF records directly if this mailbox is new.)

---

## 1. Vercel — create & link the project

```bash
cd /home/gino/programming/dev/scratch
vercel link             # select org, name the project "1scratch-web", set root to apps/web
vercel pull             # creates .vercel/ and pulls any existing env vars
```

After link, in the Vercel dashboard for the project:

- [ ] Settings → Build & Development → Root Directory = `apps/web`
- [ ] Settings → Build & Development → Framework Preset = Next.js (auto)
- [ ] Settings → Git → connect to the `1Scratch/scratch` repo (create the GitHub repo first if not already).
- [ ] Settings → Domains → add `app.1scratch.ai` and `api.1scratch.ai` (the latter is aliased to the same deployment; routing is handled by the Next.js app itself).
- [ ] Settings → General → Node.js Version = 24.x

**Verify:** `vercel env ls` returns the Vercel-managed defaults (e.g. `VERCEL_URL`).

---

## 2. Neon Postgres — via Vercel Marketplace

Vercel Marketplace auto-injects `DATABASE_URL` plus pooled/direct variants into the linked project, across all envs.

- [ ] Dashboard → Storage → Marketplace → Neon → **Create**.
- [ ] Project name: `1scratch-db`. Region: **AWS us-east-1**.
- [ ] After creation: Neon dashboard → **Branching** enabled by default (preview envs get their own branch). Confirm.
- [ ] Neon dashboard → Settings → **Compute scaling** → Scale plan (we'll be on Launch for Phase 1, upgrade to Scale in Phase 4 when EU replica is added).
- [ ] Plan item deferred to Phase 4: EU read replica (add a second region under the same project in Neon).

**Env vars auto-injected** (do NOT set manually):

- `DATABASE_URL` — pooled, for request-path queries
- `DATABASE_URL_UNPOOLED` — for migrations / drizzle-kit
- `POSTGRES_*` (legacy aliases, harmless to keep)

Update `apps/web/drizzle.config.ts` if you want migrations to use the unpooled URL — otherwise fine as-is for now.

**Run migrations:**

```bash
vercel env pull apps/web/.env.development.local
cd apps/web
pnpm db:migrate         # applies 0000_initial_schema + 0001_rls
```

**Verify:** `pnpm db:studio` opens Drizzle Studio, shows all tables from §3 with RLS enabled.

**Post-migration DB setup (one-time, via SQL console in Neon dashboard):**

```sql
-- Grant app role to the Vercel-provisioned user so request-path queries
-- run under RLS. Replace <neon_user> with the role name from DATABASE_URL.
GRANT app_user TO <neon_user>;
ALTER ROLE <neon_user> SET ROLE app_user;   -- default to non-privileged
```

Create a separate privileged connection string for webhooks (Paddle, Clerk) — use the Neon dashboard to mint a role that inherits `app_admin` (BYPASSRLS) and store as `DATABASE_URL_ADMIN` in Vercel env (scope: Production + Preview only).

---

## 3. Clerk — via Vercel Marketplace

- [ ] Dashboard → Integrations → Marketplace → Clerk → **Add Integration**.
- [ ] New Clerk application: name `1Scratch`, enable: **Email/password, Email magic link, Google, Apple, GitHub**.
- [ ] Clerk dashboard → Sessions → Access token lifetime = **15 min**; Refresh token lifetime = **30 days**, rotating on use.
- [ ] Clerk dashboard → JWT Templates → create template `app_user` that emits `{ sub, email }` (used by Next.js middleware to derive `app.user_id`).
- [ ] Clerk dashboard → Emails → Custom SMTP → point at Resend (after Step 4) so magic links ship from `support@1scratch.ai`.
- [ ] Add allowed origins: `https://app.1scratch.ai`, `1scratch://` (desktop/mobile deep link).

**Env vars auto-injected:**

- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`

Set manually in Vercel env (all envs):

- `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`
- `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`

**Verify:** `vercel dev` locally → visit `/sign-in` → Clerk hosted component renders.

---

## 4. Resend — via Vercel Marketplace

- [ ] Dashboard → Integrations → Marketplace → Resend → **Add Integration**.
- [ ] Resend dashboard → Domains → add `1scratch.ai` → copy DNS records (SPF, DKIM, DMARC) → add to `1scratch.ai` DNS provider → wait for verify (~10 min).
- [ ] Resend dashboard → API Keys → confirm the Vercel-injected key exists.

**Env vars auto-injected:**

- `RESEND_API_KEY`

Set manually:

- `RESEND_FROM_ADDRESS=support@1scratch.ai` (all envs)

**Verify:** `curl -X POST https://api.resend.com/emails -H "Authorization: Bearer $RESEND_API_KEY" -H "Content-Type: application/json" -d '{"from":"support@1scratch.ai","to":"sskgino@gmail.com","subject":"provisioning test","text":"hi"}'` → 200, message lands.

---

## 5. AI Gateway — Vercel native (no Marketplace step)

- [ ] Dashboard → AI → AI Gateway → Enable for project.
- [ ] AI Gateway dashboard → Keys → create key `1scratch-server` with scope = all providers.
- [ ] AI Gateway dashboard → Settings → **Zero Data Retention** = enabled.

**Env var to set manually:**

- `AI_GATEWAY_API_KEY=<key value>` (all envs)

**Verify:**

```bash
curl https://ai-gateway.vercel.sh/v1/chat/completions \
  -H "Authorization: Bearer $AI_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"anthropic/claude-haiku-4-5","messages":[{"role":"user","content":"ping"}]}'
```

→ streams a response.

---

## 6. AWS KMS — for envelope encryption (PLAN.md §12)

Not on Vercel Marketplace; provision in AWS.

- [ ] AWS Console → IAM → create user `vercel-kms-1scratch`, programmatic-only, no console access.
- [ ] IAM → attach inline policy: `kms:GenerateDataKey`, `kms:Decrypt`, `kms:DescribeKey` — resource-scoped to the single KEK ARN below.
- [ ] AWS KMS → Create key:
  - Type: Symmetric, Usage: Encrypt/Decrypt
  - Alias: `alias/1scratch-kek-prod`
  - Key administrators: your root/admin user (**not** the Vercel IAM user)
  - Key users: `vercel-kms-1scratch`
  - Region: `us-east-1`
- [ ] (Later, before launch) create a second KEK in `eu-central-1` with alias `alias/1scratch-kek-eu`.

**Env vars to set manually in Vercel:**

- `AWS_REGION=us-east-1`
- `AWS_KMS_KEY_ID=alias/1scratch-kek-prod`
- `AWS_ACCESS_KEY_ID=<from IAM user>`
- `AWS_SECRET_ACCESS_KEY=<from IAM user>` — mark as **Sensitive**

**Verify:** run `apps/web/src/lib/crypto/kms.ts` in a one-off script — encrypt `"ping"`, decrypt back, assert round-trip.

---

## 7. Paddle (sandbox) — separate vendor, NOT on Vercel Marketplace

Paddle vets every seller; submit the application now so it's ready by Phase 2.

- [ ] [sandbox-vendors.paddle.com](https://sandbox-vendors.paddle.com) → sign up as **1Scratch LLC** (SC entity).
- [ ] Submit: website (placeholder OK — `https://1scratch.ai` with a coming-soon page is fine), legal docs (EIN letter), business model summary, sample product page link.
- [ ] Wait 1–3 business days for approval.

Once approved:

- [ ] Sandbox dashboard → Developer Tools → Authentication → create API key `1scratch-server`.
- [ ] Developer Tools → Notifications → create webhook endpoint `https://app.1scratch.ai/api/billing/paddle/webhook`, copy signing secret.
- [ ] Catalog → Products → create `1Scratch Pro` with price `$10.00/month USD`, copy Price ID.

**Env vars to set manually in Vercel:**

- `PADDLE_API_KEY=<sandbox key>` (Preview + Development), separate live key → Production
- `PADDLE_WEBHOOK_SECRET=<from webhook config>`
- `PADDLE_PRO_PRICE_ID=<price id>`

**Verify:** `curl -H "Authorization: Bearer $PADDLE_API_KEY" https://sandbox-api.paddle.com/prices` → lists `1Scratch Pro`.

---

## 8. Sentry — separate vendor

- [ ] [sentry.io](https://sentry.io) → create org `1scratch`, plan = Developer (free).
- [ ] Create two projects: `web` (Next.js platform) and `client` (JavaScript Browser platform).
- [ ] Copy each DSN.
- [ ] Install in `apps/web`: `pnpm --filter @1scratch/web add @sentry/nextjs` (deferred to Phase 1 final sub-step — not required for provisioning).

**Env var to set manually:**

- `SENTRY_DSN=<web project DSN>` (all envs)
- `NEXT_PUBLIC_SENTRY_DSN=<web project DSN>` (same value, client-exposed)
- `SENTRY_ORG=1scratch`, `SENTRY_PROJECT=web`, `SENTRY_AUTH_TOKEN=<org auth token>` (Production + Preview only — required for source-map upload in build)

---

## 9. Axiom — via Vercel Marketplace

- [ ] Dashboard → Integrations → Marketplace → Axiom → **Add Integration**.
- [ ] Axiom dashboard → Datasets → confirm `1scratch-web` dataset exists (or create).
- [ ] Axiom dashboard → Settings → Retention = 30 days (matches PLAN.md §2 — audit log retention).

**Env vars auto-injected:**

- `AXIOM_TOKEN`
- `AXIOM_DATASET`

---

## 10. Wrap-up: verify env scopes

```bash
cd /home/gino/programming/dev/scratch
vercel env ls
```

Expected set, by scope:

| Var | Development | Preview | Production |
|---|---|---|---|
| `DATABASE_URL` (Neon auto) | ✓ | ✓ | ✓ |
| `DATABASE_URL_UNPOOLED` (Neon auto) | ✓ | ✓ | ✓ |
| `DATABASE_URL_ADMIN` (manual) |  | ✓ | ✓ |
| `CLERK_SECRET_KEY` (Clerk auto) | ✓ | ✓ | ✓ |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (Clerk auto) | ✓ | ✓ | ✓ |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `..._SIGN_UP_URL` (manual) | ✓ | ✓ | ✓ |
| `RESEND_API_KEY` (Resend auto) | ✓ | ✓ | ✓ |
| `RESEND_FROM_ADDRESS` (manual) | ✓ | ✓ | ✓ |
| `AI_GATEWAY_API_KEY` (manual) | ✓ | ✓ | ✓ |
| `AWS_REGION`, `AWS_KMS_KEY_ID` (manual) | ✓ | ✓ | ✓ |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (manual, Sensitive) | ✓ | ✓ | ✓ |
| `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_PRO_PRICE_ID` (manual) | ✓ (sandbox) | ✓ (sandbox) | ✓ (live) |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` (manual) | ✓ | ✓ | ✓ |
| `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` (manual) |  | ✓ | ✓ |
| `AXIOM_TOKEN`, `AXIOM_DATASET` (Axiom auto) | ✓ | ✓ | ✓ |

Then pull to local:

```bash
vercel env pull apps/web/.env.development.local
```

**Final verify:** `cd apps/web && pnpm dev` → `http://localhost:3000/api/health` returns 200 with a body including a live DB timestamp.

---

## Still owed to the user (PLAN.md §14, not blocking Phase 1 code)

- [ ] Apple Developer Program enrollment under 1Scratch LLC (needs D-U-N-S — free from Dun & Bradstreet, ~1–2 weeks). Start now.
- [ ] Google Play Console registration ($25, ID verification ~3–5 days). Start now.
- [ ] Paddle seller approval (Step 7 above — same 1–3 business day timeline).
