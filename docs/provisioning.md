# Phase 1 Provisioning Runbook

Executable checklist for PLAN.md Phase 1, bullet 1:
**"Provision: Vercel project, Neon DB (us-east + EU read replica), Clerk, Resend, Paddle (sandbox), AI Gateway, Sentry, Axiom."**

Also sets up AWS KMS (per PLAN.md §12 locked decision). All services are pay-as-you-go at free/dev tiers while we're in Phase 1 — keep an eye on the final checklist before Phase 4 launch.

---

## Status (updated 2026-04-17)

| Step | Service | Status |
|---|---|---|
| 0 | Prereqs | ✅ Done |
| 1 | Vercel project + Git + domains + first deploy | ✅ Done |
| 2 | Neon Postgres + roles + `DATABASE_URL_ADMIN` | ✅ Done (see deviation below) |
| 3 | Clerk | 🟡 Marketplace env vars + sign-in/up URL vars set; dashboard config for sessions + JWT template + allowed origins completed in-session; **Resend email delivery via `emails.created` webhook pending** (Clerk deprecated dashboard Custom SMTP — new pattern); webhook handler deferred to Phase 1 final sub-step |
| 4 | Resend | ✅ Done (manual path — Marketplace integration failed with auth error) |
| 5 | AI Gateway | ✅ Done (ZDR deferred — Hobby plan; see PLAN.md TODO) |
| 6 | AWS KMS | ✅ Done (seal/open round-trip verified; EncryptionContext binding enforced) |
| 7 | Paddle (sandbox) | 🟡 Signed up, product + price + webhook created; API key verified. Dev env set; **Preview scope pending dashboard**; **Production waits on live Paddle approval + live API key** (Phase 2 exit). |
| 8 | Sentry | ✅ Done (org + 2 projects, DSNs captured, env vars set Dev + Preview + Prod via CLI + dashboard; `@sentry/nextjs` install deferred to Phase 1 final sub-step per original plan) |
| 9 | Axiom | ✅ Done (Marketplace integration added; `NEXT_PUBLIC_AXIOM_INGEST_ENDPOINT` set all 3 envs; dataset = `vercel` default; retention confirmed in Axiom) |

### Deviations from original plan

- **Step 2 / `DATABASE_URL_ADMIN`:** Doc says "mint a role via the Neon dashboard." Neon's SQL Editor and dashboard both run every session under `SET ROLE app_user` (the default applied to `neondb_owner`), which silently blocked `CREATE ROLE` and `ALTER ROLE`. Fixed by running the role setup from a Node script that explicitly executes `SET ROLE neondb_owner` first within a single transaction. Result: `admin_user` exists with LOGIN + password, has `GRANT app_admin`, and `ALTER ROLE admin_user SET ROLE app_admin` makes it default to the BYPASSRLS role. **Gotcha:** `BYPASSRLS` is a role *attribute*, not a privilege — it does **not** inherit through group membership. The `SET ROLE app_admin` default is what makes BYPASSRLS effectively apply for `admin_user` sessions.
- **Step 4 / Resend:** Vercel Marketplace integration flow errored with *"The user does not have an active session or is not authenticated"*. Bypassed by signing up at resend.com directly, verifying `1scratch.ai` via Cloudflare DNS, creating the API key manually, and adding `RESEND_API_KEY` (Sensitive for Prod+Preview, non-Sensitive for Dev — Vercel rejects Sensitive-scope on Development).
- **CLI quirk noted (applies to all remaining manual env vars):** `vercel env add NAME preview` returns a "choose branch" JSON guidance even when given `--value ... --yes`. Workaround: add Preview scope via the Vercel dashboard (check both Production and Preview boxes when editing).
- **CLI quirk — trailing newline from `echo`:** `echo "value" | vercel env add …` pipes a trailing `\n` that Vercel stores as part of the value. Caught after AWS SDK rejected `region="us-east-1\n"`. **Always use `printf '%s' "value" | vercel env add …`** (no trailing newline). All previously-added `AI_GATEWAY_API_KEY` and `AWS_*` values were removed and re-added cleanly with `printf`.
- **Step 3 / Clerk Custom SMTP removed:** Plan originally said "Clerk dashboard → Emails → Custom SMTP → point at Resend." As of 2026 Clerk **no longer exposes SMTP credential fields in the dashboard**. New pattern: toggle "Delivered by Clerk" OFF per email template → Clerk emits `emails.created` webhook → our Next.js handler sends via Resend SDK. Webhook handler is implementation work, deferred to Phase 1 final sub-step (same bucket as `@sentry/nextjs` install). See Step 3 below for the exact plan.
- **Step 3 / Clerk JWT template — `sub` claim reserved:** Original plan's template emitted `{ sub, email }`. Clerk blocks overriding `sub` (it's always auto-emitted with `user.id`). Template in dashboard emits `{ email }` only; middleware reads `sub` from Clerk's default claim set. Functionally identical.
- **Step 10 / health route required a real DB call:** Doc originally expected `/api/health` to return a "live DB timestamp." The scaffolded handler at `apps/web/src/app/api/health/route.ts` only returned `new Date().toISOString()`. Updated to `select now() as db_time` via the `@neondatabase/serverless` tagged-template client (direct neon, not drizzle — the drizzle `neon-http` `db.execute(sql...)` path threw `"This function can now be called only as a tagged-template function"` in drizzle-orm 0.36). This verifies end-to-end DB reachability from Dev env.

---

## 0. Prereqs ✅

- [x] Vercel account exists, logged into [vercel.com/dashboard](https://vercel.com/dashboard) under an org owned by **1Scratch LLC** (team: `1-scratch-llc`).
- [x] Vercel CLI at 51.6.1.
- [x] `vercel login` — signed in as `sskgino-8710`.
- [x] Domain `1scratch.ai` owned; DNS hosted at Cloudflare.
- [x] Transactional mailbox `support@1scratch.ai` works. SPF/DKIM/DMARC now owned by Resend (Step 4).

---

## 1. Vercel — create & link the project ✅

```bash
cd /home/gino/programming/dev/scratch
vercel link             # select org, name the project "1scratch-web", set root to apps/web
vercel pull             # creates .vercel/ and pulls any existing env vars
```

After link, in the Vercel dashboard for the project:

- [x] Settings → Build & Development → Root Directory = `apps/web`
- [x] Settings → Build & Development → Framework Preset = Next.js (auto)
- [x] Settings → Git → connected to `sskgino/1scratch` (local uses SSH remote `git@github.com:sskgino/1scratch.git`).
- [x] Settings → Domains → `app.1scratch.ai` and `api.1scratch.ai` added.
- [x] Settings → General → Node.js Version = 24.x

**First deploy (green):** `https://1scratch-enjiu3udf-1-scratch-llc.vercel.app` — 33s build from initial commit.

---

## 2. Neon Postgres — via Vercel Marketplace ✅

Vercel Marketplace auto-injects `DATABASE_URL` plus pooled/direct variants into the linked project, across all envs.

- [x] Dashboard → Storage → Marketplace → Neon → **Create**.
- [x] Project name: `1scratch-db`. Region: **AWS us-east-1**.
- [x] Branching enabled.
- [x] Launch plan active.
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

**Post-migration DB setup (done):**

```sql
-- Applied to neondb_owner (the Vercel-provisioned login role)
GRANT app_user TO neondb_owner;
ALTER ROLE neondb_owner SET ROLE app_user;  -- default to non-privileged
```

**Privileged login role for webhooks/migrations (done, via Node script not Neon dashboard):**

```sql
-- Ran with `SET ROLE neondb_owner` prefix inside a single transaction,
-- because the SQL Editor session starts as app_user and silently blocks DDL.
CREATE ROLE admin_user WITH LOGIN PASSWORD 'BossmanGino$$';
GRANT app_admin TO admin_user;
ALTER ROLE admin_user SET ROLE app_admin;   -- makes BYPASSRLS effectively apply
```

> **Gotcha:** `BYPASSRLS` is a role attribute, not a privilege — it doesn't inherit through `GRANT`. The `SET ROLE app_admin` default is what makes BYPASSRLS apply for `admin_user`'s sessions.

`DATABASE_URL_ADMIN` stored in Vercel env (scope: **Production + Preview only**):

```
postgresql://admin_user:BossmanGino$$@ep-jolly-brook-a4tcj7ay-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

---

## 3. Clerk — via Vercel Marketplace 🟡

- [x] Dashboard → Integrations → Marketplace → Clerk → **Add Integration**.
- [x] Clerk application name = `1Scratch`; enabled sign-ins: **Email/password, Email magic link, Google, Apple, GitHub**.
- [x] Clerk dashboard → Sessions → Access token lifetime = **15 min (900s)**; Refresh token lifetime = **30 days** with rotation on use.
- [x] Clerk dashboard → JWT Templates → template `app_user` created. **Deviation:** `sub` is a Clerk-reserved claim — cannot be overridden in a custom template. Template emits only `{ "email": "{{user.primary_email_address}}" }`. Middleware reads `sub = user.id` from Clerk's default claim set (always present).
- [x] Allowed origins added: `https://app.1scratch.ai`, `1scratch://` (desktop/mobile deep link).
- [ ] **Resend email delivery — pending, see sub-section below.**

**Env vars auto-injected (confirmed present):**

- `CLERK_SECRET_KEY` ✅ (all envs)
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` ✅ (all envs)

**Env vars set manually via CLI:**

- [x] `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in` — Dev ✅ · Prod ✅ · Preview ⏳ dashboard (same `git_branch_required` quirk)
- [x] `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up` — Dev ✅ · Prod ✅ · Preview ⏳ dashboard

**Verify:** `vercel dev` locally → visit `/sign-in` → Clerk hosted component renders.

### 3a. Clerk → Resend email delivery (pending)

Clerk deprecated dashboard Custom SMTP. New pattern per [Clerk docs](https://clerk.com/docs/guides/customizing-clerk/email-sms-templates):

1. **Dashboard → Customization → Emails** → for each template (magic link / OTP / verification code / reset password / organization invitation) toggle **"Delivered by Clerk" OFF**.
2. **Dashboard → Webhooks → Add endpoint**:
   - URL: `https://app.1scratch.ai/api/webhooks/clerk`
   - Subscribe to events: `email.created` (required for Resend delivery), plus `user.created` + `user.deleted` (needed for syncing Clerk user → Postgres `users` table — Phase 1 exit criterion).
   - Copy the signing secret (format `whsec_...`).
3. **Env var to add** (once secret captured):
   - `CLERK_WEBHOOK_SECRET` = `whsec_...` — Prod (**Sensitive**) · Preview (**Sensitive**, via dashboard) · Dev (non-Sensitive).
4. **Webhook handler** (`apps/web/src/app/api/webhooks/clerk/route.ts`) — **deferred to Phase 1 final sub-step** (same bucket as `@sentry/nextjs` install). Responsibilities:
   - Verify Svix signature using `CLERK_WEBHOOK_SECRET` (via `svix` npm package).
   - On `email.created`: extract `to_email_address`, `subject`, `body`, `from_email_name` from payload → `resend.emails.send({ from: 'support@1scratch.ai', to, subject, html: body })`.
   - On `user.created`: upsert into Postgres `users` table (id = Clerk user ID).
   - On `user.deleted`: trigger account cascade delete (§2 threat model GDPR erasure path).

---

## 4. Resend — manual signup ✅ (Marketplace path failed)

Marketplace "Add Integration" returned *"The user does not have an active session or is not authenticated"* — root cause not diagnosed. Worked around by direct signup.

- [x] Signed up at [resend.com](https://resend.com).
- [x] Resend dashboard → Domains → `1scratch.ai` added → DNS records (SPF / DKIM-CNAME / DMARC) added in Cloudflare with **grey cloud (DNS only)** on CNAMEs → verified.
- [x] API key `1scratch-server` created (full access, scoped to `1scratch.ai`).

**Env vars set manually in Vercel:**

- `RESEND_API_KEY` — Production (Sensitive), Preview (Sensitive), Development (non-Sensitive — Vercel rejects Sensitive on Development scope).
- `RESEND_FROM_ADDRESS=support@1scratch.ai` — all envs.

**Verified:** test send to `sskgino@gmail.com` returned `id=b56b610a-7722-4553-a8b6-92b84f16ca4f` and was received.

---

## 5. AI Gateway — Vercel native (no Marketplace step) ✅

- [x] Dashboard → AI → AI Gateway → Enable for project.
- [x] AI Gateway dashboard → Keys → create key `1scratch-server` with scope = all providers. Key ID prefix `vck_2ax1PR…`.
- [ ] AI Gateway dashboard → Settings → **Zero Data Retention** — **deferred: Hobby plan does not expose the toggle**. Tracked in PLAN.md TODO; must flip on before any real user traffic.

**Env var `AI_GATEWAY_API_KEY`:**

- [x] Production — added via CLI (`--sensitive`)
- [x] Preview — added via dashboard (CLI quirk: `vercel env add NAME preview` returns `git_branch_required` even with `--value/--yes` — same workaround used for Resend)
- [x] Development — added via CLI (non-sensitive)

**Verified:** curl against `anthropic/claude-haiku-4.5` returned `pong 🏓` at $0.000053/call; routing resolved to `anthropic` provider with `bedrock` + `vertexAnthropic` fallbacks available.

```bash
curl https://ai-gateway.vercel.sh/v1/chat/completions \
  -H "Authorization: Bearer $AI_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"anthropic/claude-haiku-4.5","messages":[{"role":"user","content":"ping"}]}'
```

> **Model slug format:** AI Gateway uses dotted versions (`claude-haiku-4.5`), not hyphens. The provider resolves to the dated snapshot `claude-haiku-4-5-20251001` internally.

---

## 6. AWS KMS — for envelope encryption (PLAN.md §12) ✅

Not on Vercel Marketplace; provisioned directly in AWS.

**Correct order** (the original doc listed these reversed — the IAM policy needs the KEK ARN, and KMS "Key users" needs the IAM user to already exist):

- [x] AWS Console → **IAM** (not IAM Identity Center — that's the SSO product for human users) → Users → create `vercel-kms-1scratch`, programmatic-only, no console access, no policies yet. Generated an Access Key ID + Secret.
- [x] AWS KMS (Region us-east-1) → Create key:
  - Symmetric, Encrypt/Decrypt
  - Alias: `1scratch-kek-prod` (stored as `alias/1scratch-kek-prod`)
  - Key administrators: **left empty** — the default key policy's `arn:aws:iam::<acct>:root` statement grants full admin access to the account root, which is sufficient. Only add admins later if we create a dedicated admin IAM user.
  - Key users: `vercel-kms-1scratch`
  - **ARN:** `arn:aws:kms:us-east-1:784055307405:key/5e1e4f40-08ba-43b4-8a5b-7411045ff37a`
- [x] IAM → `vercel-kms-1scratch` → Add inline policy `1scratch-kek-prod-use`, scoped to the KEK ARN above:
  ```json
  {
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": ["kms:GenerateDataKey", "kms:Decrypt", "kms:DescribeKey"],
      "Resource": "arn:aws:kms:us-east-1:784055307405:key/5e1e4f40-08ba-43b4-8a5b-7411045ff37a"
    }]
  }
  ```
- [ ] **Deferred to Phase 4:** create a second KEK in `eu-central-1` with alias `1scratch-kek-eu` for EU data-residency routing.

### Deviation

- Initial key was mistakenly created in **us-east-2** (Ohio) before noticing the region mismatch with Neon (`us-east-1`). The Ohio key was scheduled for 7-day deletion (KMS minimum) and replaced with a key in `us-east-1`.

**Env vars set in Vercel** (all via `printf '%s' "value" | vercel env add …` — see CLI trailing-newline quirk in Deviations):

- `AWS_REGION=us-east-1` — Prod + Dev (Preview pending dashboard)
- `AWS_KMS_KEY_ID=alias/1scratch-kek-prod` — Prod + Dev
- `AWS_ACCESS_KEY_ID` — Prod + Dev
- `AWS_SECRET_ACCESS_KEY` — Prod (**Sensitive**) + Dev (non-Sensitive)

**Verified:** `node --env-file=apps/web/.env.development.local apps/web/scripts/verify-kms.mjs`:
- Round-trip seal/open of `sk-ant-api03-TEST-PLAINTEXT-VERIFY` succeeded (34B ciphertext, 184B KMS-wrapped DEK)
- Negative test: decrypting with a mutated `rowId` EncryptionContext throws `InvalidCiphertextException` → binding is enforced, row-swap attacks blocked

---

## 7. Paddle (sandbox) — separate vendor, NOT on Vercel Marketplace 🟡

Paddle sandbox sign-up went through without the 1–3 day wait (sandbox is self-serve; only **production** sellers get vetted, which happens at Phase 2 exit when we apply for live).

- [x] [sandbox-vendors.paddle.com](https://sandbox-vendors.paddle.com) — signed up as **1Scratch LLC**.
- [x] Sandbox dashboard → Developer Tools → Authentication → created API key `1scratch-server` (granted all permissions — sandbox only; production key will be scoped to Customers/Transactions/Subscriptions/Prices/Products/Events).
- [x] Developer Tools → Notifications → created webhook destination `https://app.1scratch.ai/api/billing/paddle/webhook` (ID `ntfset_01kpf3zvth56b3ezjd97kwp18j`) + Platform-usage event scope; captured signing secret.
- [x] Catalog → Products → `1Scratch Pro` created (`pro_01kpf42trs4gekehyndxbcgr2c`) with attached price `pri_01kpf43xe4jrq698xc5twnhtv6` @ $10.00 USD, monthly recurring, no trial.
- [ ] **Deferred to Phase 2 exit:** submit production seller application (1–3 business days approval); create production API key + price + webhook in the live Paddle dashboard.

**Verified:** `GET https://sandbox-api.paddle.com/prices` with the sandbox API key returns the `pri_01kpf43xe4jrq698xc5twnhtv6` row.

**Env vars (sandbox values; live values added at Phase 2 exit):**

- `PADDLE_API_KEY` — Development ✅ (CLI, non-Sensitive) · Preview ⏳ dashboard (add as **Sensitive**) · Production ⏳ (separate live key at Phase 2 exit)
- `PADDLE_WEBHOOK_SECRET` — Development ✅ · Preview ⏳ dashboard (add as **Sensitive**) · Production ⏳ (live secret at Phase 2 exit)
- `PADDLE_PRO_PRICE_ID` — Development ✅ · Preview ⏳ dashboard · Production ⏳ (live price ID at Phase 2 exit)

> **Sandbox vs live split:** the sandbox API key is safe in Dev + Preview because its scope is the sandbox-only test data, but it MUST NOT leak into Production. When we apply for live Paddle and get approved, a new set of live credentials is added to Production only — sandbox stays in Preview for staging tests.

---

## 8. Sentry — separate vendor ✅

- [x] [sentry.io](https://sentry.io) → org created. **Slug:** `1scratch-llc` (plan had `1scratch` — Sentry appended `-llc` to match legal entity name; JWT payload `"org":"1scratch-llc"` is authoritative). Plan = Developer (free).
- [x] Two projects created: `web` (Next.js platform) and `client` (JavaScript Browser platform).
- [x] DSNs captured:
  - **web:** `https://9e7fbc68c4a76a54d3eaebeb4852e973@o4511238803030016.ingest.us.sentry.io/4511238810304512`
  - **client:** `https://4f8b601683b530a2aa97fa8bf645d016@o4511238803030016.ingest.us.sentry.io/4511238833045504` (reserved for future Tauri desktop/mobile — not wired into Next.js build; Sentry Next.js SDK handles both server + client errors under one project)
- [x] Org-level auth token created (name `1scratch-server`, region US). Sentry blocks scope editing on **organization tokens** — default scopes include `project:releases` + `org:read` which is what the Next.js SDK needs for source-map uploads. Acceptable.
- [ ] Install in `apps/web`: `pnpm --filter @1scratch/web add @sentry/nextjs` — **deferred to Phase 1 final sub-step per original plan; not required for provisioning.**

**Env vars set in Vercel** (via `printf '%s' "value" | vercel env add …` — see CLI trailing-newline quirk in Deviations):

- `SENTRY_DSN` = web DSN — Dev ✅ (non-sensitive, CLI) · Prod ✅ (**Sensitive**, CLI) · Preview ✅ (**Sensitive**, dashboard — CLI `git_branch_required` quirk blocked Preview scope)
- `NEXT_PUBLIC_SENTRY_DSN` = web DSN — Dev ✅ · Prod ✅ · Preview ✅ (non-sensitive; client-exposed by design)
- `SENTRY_ORG=1scratch-llc` — Prod ✅ · Preview ✅ (not added to Dev — source-map upload only runs in CI builds)
- `SENTRY_PROJECT=web` — Prod ✅ · Preview ✅
- `SENTRY_AUTH_TOKEN` = `sntrys_…` org token — Prod ✅ (**Sensitive**) · Preview ✅ (**Sensitive**)

---

## 9. Axiom — via Vercel Marketplace ✅

Axiom's Vercel integration has changed since PLAN.md was written: **no more `AXIOM_TOKEN` / `AXIOM_DATASET` pair**. The integration now injects a single signed ingest endpoint `NEXT_PUBLIC_AXIOM_INGEST_ENDPOINT` with `configurationId` + `projectId` embedded as query params, scoped to `type=web-vitals`. Functions/Edge logs ship separately via an auto-configured Vercel Log Drain that the integration sets up server-side (no env var needed).

- [x] Dashboard → Integrations → Marketplace → Axiom → **Add Integration**.
- [x] Dataset auto-created: **`vercel`** (integration default; original plan said `1scratch-web` — cosmetic-only, no blocker).
- [x] Retention confirmed in Axiom dashboard (free tier default matches PLAN.md §2's 30-day audit-log requirement).
- [x] Log drain active (auto-configured by integration — ships Functions + Edge logs to the `vercel` dataset alongside web-vitals).

**Env vars auto-injected + propagated:**

- `NEXT_PUBLIC_AXIOM_INGEST_ENDPOINT` — Prod ✅ (Marketplace auto-inject) · Dev ✅ (CLI, same value) · Preview ✅ (dashboard — same CLI `git_branch_required` quirk)

> **Deviation from plan:** doc previously listed `AXIOM_TOKEN` + `AXIOM_DATASET` as the injected vars. New Axiom-Vercel integration replaces both with the single signed-endpoint pattern. Server-side Axiom queries (if ever needed — not required for Phase 1) would need a separately-created `AXIOM_TOKEN` via `https://app.axiom.co` → Settings → API Tokens.

---

## 10. Wrap-up: verify env scopes ✅

**Status (2026-04-18):** `vercel env ls` run — all expected keys present; final `/api/health` check hit Neon and returned `db_time` successfully.

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
| `NEXT_PUBLIC_AXIOM_INGEST_ENDPOINT` (Axiom auto Prod; CLI Dev; dashboard Preview) | ✓ | ✓ | ✓ |
| `CLERK_WEBHOOK_SECRET` (manual, pending user creating webhook in Clerk) |  ⏳ (non-Sensitive) |  ⏳ (Sensitive) |  ⏳ (Sensitive) |

Then pull to local:

```bash
vercel env pull apps/web/.env.development.local
```

**Final verify (completed 2026-04-18):** `cd apps/web && pnpm dev` → `curl http://localhost:3000/api/health`:

```json
{
  "status": "ok",
  "service": "1scratch-web",
  "time": "2026-04-18T04:38:55.642Z",
  "db_time": "2026-04-18T04:38:55.608Z"
}
```

The route at `apps/web/src/app/api/health/route.ts` was updated from a static timestamp to a live `select now() as db_time` query against Neon (direct `@neondatabase/serverless` tagged-template client — drizzle's `neon-http` execute path threw in drizzle-orm 0.36, see Deviations).

---

## Still owed to the user (PLAN.md §14, not blocking Phase 1 code)

- [ ] Apple Developer Program enrollment under 1Scratch LLC (needs D-U-N-S — free from Dun & Bradstreet, ~1–2 weeks). Start now.
- [ ] Google Play Console registration ($25, ID verification ~3–5 days). Start now.
- [ ] Paddle seller approval (Step 7 above — same 1–3 business day timeline).
