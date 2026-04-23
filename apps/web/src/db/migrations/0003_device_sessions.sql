-- Phase 3a: device sessions (mobile + future desktop). One active row per
-- (user_id, device_id); rotate replaces row in place. Refresh stored as
-- sha256 hex; plaintext returned only at issue time.

CREATE TABLE device_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  device_label text,
  refresh_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (user_id, device_id)
);

ALTER TABLE device_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY device_sessions_owner ON device_sessions
  FOR ALL
  USING (user_id = current_setting('app.user_id', true));

CREATE INDEX device_sessions_refresh_hash_active_idx
  ON device_sessions (refresh_hash) WHERE revoked_at IS NULL;
