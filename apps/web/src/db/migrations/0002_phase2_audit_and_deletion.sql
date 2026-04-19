-- Phase 2 additions: auth audit log + account deletion cool-off.
--
-- auth_events                 — append-only audit trail; see PLAN.md §2.
-- account_deletion_requests   — 24-hr revocable delete window; see §5.
--
-- Both tables inherit the same RLS pattern (user_id = app_current_user_id()).
-- The purge cron and confirmation-token routes run under app_admin.

CREATE TABLE IF NOT EXISTS "auth_events" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,                -- 'sign_in' | 'credential_add' | 'credential_remove' | 'decrypt_for_use' | 'account_delete_request' | 'account_delete_cancel' | 'account_delete_executed' | 'scratch_imported' | ...
  "ip" inet,
  "ua" text,
  "meta" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "ts" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "auth_events_user_ts_idx"
  ON "auth_events" ("user_id", "ts" DESC);

-- One active request per user. confirm_token_hash is sha256(random token);
-- the plaintext token is emailed to the user and never stored.
CREATE TABLE IF NOT EXISTS "account_deletion_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "confirm_token_hash" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'cancelled', 'executed')),
  "requested_at" timestamp with time zone NOT NULL DEFAULT now(),
  "confirmed_at" timestamp with time zone,
  "executes_after" timestamp with time zone NOT NULL,
  "cancelled_at" timestamp with time zone,
  "executed_at" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "account_deletion_requests_active_user_idx"
  ON "account_deletion_requests" ("user_id")
  WHERE status IN ('pending', 'confirmed');
CREATE INDEX IF NOT EXISTS "account_deletion_requests_token_idx"
  ON "account_deletion_requests" ("confirm_token_hash")
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS "account_deletion_requests_execute_idx"
  ON "account_deletion_requests" ("executes_after")
  WHERE status = 'confirmed';

-- Grants for app_user / app_admin (same pattern as 0001).
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_events" TO app_user, app_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON "account_deletion_requests" TO app_user, app_admin;
GRANT USAGE, SELECT ON SEQUENCE "auth_events_id_seq" TO app_user, app_admin;

ALTER TABLE "auth_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auth_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE "account_deletion_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_deletion_requests" FORCE ROW LEVEL SECURITY;

-- Users read their own audit events. Inserts happen from request handlers
-- which pass through RLS (user_id scoped) or from admin paths (webhooks).
CREATE POLICY "auth_events_owner_read" ON "auth_events"
  FOR SELECT
  USING (user_id = app_current_user_id());

CREATE POLICY "auth_events_owner_write" ON "auth_events"
  FOR INSERT
  WITH CHECK (user_id = app_current_user_id());

CREATE POLICY "account_deletion_requests_owner" ON "account_deletion_requests"
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());
