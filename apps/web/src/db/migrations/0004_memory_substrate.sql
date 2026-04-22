-- Phase 4 Memory M1a — substrate + pluggable strategies + per-user vectors.
-- Replaces PLAN §3 placeholder memory_chunks stub.

CREATE EXTENSION IF NOT EXISTS vector;

-- Drop the old placeholder stub (pre-M1 had zero rows).
DROP TABLE IF EXISTS memory_chunks;

-- ─── memory_items — canonical, strategy-agnostic store ─────────────────────
CREATE TABLE memory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_kind text NOT NULL CHECK (scope_kind IN ('user','workspace','section','canvas')),
  scope_ref_id uuid,
  CHECK ((scope_kind = 'user') = (scope_ref_id IS NULL)),
  source_kind text NOT NULL,
  source_ref_id uuid,
  text text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}',
  tier text NOT NULL DEFAULT 'long' CHECK (tier IN ('short','long')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX memory_items_user_scope_idx
  ON memory_items (user_id, scope_kind, scope_ref_id)
  WHERE expires_at IS NULL OR expires_at > now();
CREATE INDEX memory_items_tags_gin_idx ON memory_items USING gin (tags);
CREATE INDEX memory_items_source_idx ON memory_items (user_id, source_kind, source_ref_id);
-- Idempotency for card_pair ingestor: dedupe on (user, card, response_sha256 metadata key).
CREATE UNIQUE INDEX memory_items_card_pair_idem_idx
  ON memory_items (user_id, source_kind, source_ref_id, (metadata->>'response_sha256'))
  WHERE source_kind = 'card_pair' AND metadata ? 'response_sha256';

ALTER TABLE memory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_items FORCE ROW LEVEL SECURITY;
CREATE POLICY memory_items_owner ON memory_items
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

-- ─── memory_vectors — per-(item, embedding-model) cache ────────────────────
CREATE TABLE memory_vectors (
  memory_item_id uuid NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
  embedding_model_id text NOT NULL,
  dim int NOT NULL,
  embedding vector,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (memory_item_id, embedding_model_id)
);
CREATE INDEX memory_vectors_ann_idx ON memory_vectors USING hnsw (embedding vector_cosine_ops);

ALTER TABLE memory_vectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_vectors FORCE ROW LEVEL SECURITY;
CREATE POLICY memory_vectors_owner ON memory_vectors
  USING (EXISTS (SELECT 1 FROM memory_items m
                 WHERE m.id = memory_vectors.memory_item_id
                   AND m.user_id = app_current_user_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM memory_items m
                       WHERE m.id = memory_vectors.memory_item_id
                         AND m.user_id = app_current_user_id()));

-- ─── memory_edges — forward-compat for graph strategies ────────────────────
CREATE TABLE memory_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_item_id uuid NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
  to_item_id uuid NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
  rel text NOT NULL,
  weight real NOT NULL DEFAULT 1.0,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX memory_edges_from_idx ON memory_edges (user_id, from_item_id, rel);
CREATE INDEX memory_edges_to_idx ON memory_edges (user_id, to_item_id, rel);
ALTER TABLE memory_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_edges FORCE ROW LEVEL SECURITY;
CREATE POLICY memory_edges_owner ON memory_edges
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

-- ─── memory_facts — forward-compat for semantic/triple strategies ──────────
CREATE TABLE memory_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_kind text NOT NULL CHECK (scope_kind IN ('user','workspace','section','canvas')),
  scope_ref_id uuid,
  subject text NOT NULL,
  predicate text NOT NULL,
  object jsonb NOT NULL,
  source_item_id uuid REFERENCES memory_items(id) ON DELETE SET NULL,
  confidence real NOT NULL DEFAULT 1.0,
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX memory_facts_subject_idx ON memory_facts (user_id, subject);
CREATE INDEX memory_facts_predicate_idx ON memory_facts (user_id, predicate);
ALTER TABLE memory_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_facts FORCE ROW LEVEL SECURITY;
CREATE POLICY memory_facts_owner ON memory_facts
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

-- ─── memory_strategy_config — per-(user, scope, strategy) settings ─────────
CREATE TABLE memory_strategy_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_kind text NOT NULL CHECK (scope_kind IN ('user','workspace','section','canvas','task')),
  scope_ref_id uuid,
  strategy text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  weight real NOT NULL DEFAULT 1.0,
  params jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, scope_kind, scope_ref_id, strategy)
);
ALTER TABLE memory_strategy_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_strategy_config FORCE ROW LEVEL SECURITY;
CREATE POLICY memory_strategy_config_owner ON memory_strategy_config
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

-- ─── users — per-user memory settings + quota counters ─────────────────────
ALTER TABLE users
  ADD COLUMN memory_embedding_model_id text,
  ADD COLUMN memory_embedding_provider text
    CHECK (memory_embedding_provider IN ('gateway','byok','local')),
  ADD COLUMN memory_injection_policy jsonb NOT NULL
    DEFAULT '{"format":"system-message","token_budget":2000,"top_k":8}'::jsonb,
  ADD COLUMN memory_item_count int NOT NULL DEFAULT 0,
  ADD COLUMN memory_bytes_count bigint NOT NULL DEFAULT 0;

-- ─── ai_usage — add kind discriminator for unified cap accounting ──────────
ALTER TABLE ai_usage
  ADD COLUMN kind text NOT NULL DEFAULT 'completion'
    CHECK (kind IN ('completion','embedding'));
