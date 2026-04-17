-- Row-Level Security: every user-owned table is restricted to rows whose
-- user_id matches the `app.user_id` GUC the request handler sets via
-- dbForUser(userId) in src/db/client.ts. If the GUC is unset, queries
-- return zero rows and writes fail — fail-closed.
--
-- The webhook handler (Paddle) and the Clerk user-created hook are the
-- only paths that need to bypass RLS. Those use a separate role.

-- ─── Roles ──────────────────────────────────────────────────────────────────

-- The application connects as `app_user` for normal request traffic.
-- A privileged `app_admin` role is for migrations and webhook handlers
-- that legitimately need cross-tenant access (e.g. Paddle webhook
-- promoting a user to Pro before that user has logged in this session).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin') THEN
    CREATE ROLE app_admin BYPASSRLS;
  END IF;
END$$;

GRANT USAGE ON SCHEMA public TO app_user, app_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user, app_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user, app_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user, app_admin;

-- ─── Helper ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app_current_user_id()
RETURNS text
LANGUAGE sql STABLE
AS $$ SELECT current_setting('app.user_id', true) $$;

-- ─── Enable RLS + policies ──────────────────────────────────────────────────

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users',
    'workspaces',
    'sections',
    'canvases',
    'cards',
    'mutations',
    'provider_connections',
    'model_slots',
    'ai_usage',
    'billing_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END$$;

-- users: row whose id matches the GUC.
CREATE POLICY users_self ON users
  USING (id = app_current_user_id())
  WITH CHECK (id = app_current_user_id());

-- All other tables: user_id matches the GUC.
CREATE POLICY workspaces_owner ON workspaces
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

CREATE POLICY sections_owner ON sections
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

CREATE POLICY canvases_owner ON canvases
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

CREATE POLICY cards_owner ON cards
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

CREATE POLICY mutations_owner ON mutations
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

CREATE POLICY provider_connections_owner ON provider_connections
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

CREATE POLICY model_slots_owner ON model_slots
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

CREATE POLICY ai_usage_owner ON ai_usage
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

-- billing_events: webhook is the only writer (uses app_admin / BYPASSRLS).
-- End users can only see their own event rows for receipts/history.
CREATE POLICY billing_events_owner ON billing_events
  FOR SELECT
  USING (user_id = app_current_user_id());
