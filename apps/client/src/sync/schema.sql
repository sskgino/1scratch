-- Materialized projections
CREATE TABLE canvases (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  section_id   TEXT NOT NULL,
  name         TEXT NOT NULL,
  color        TEXT,
  viewport     TEXT NOT NULL,    -- JSON
  position     INTEGER NOT NULL,
  version      TEXT NOT NULL,    -- HLC bigint as decimal string
  updated_at   INTEGER NOT NULL
);
CREATE INDEX canvases_section ON canvases(section_id, position);

CREATE TABLE sections (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name         TEXT NOT NULL,
  color        TEXT,
  position     INTEGER NOT NULL,
  permanent    INTEGER NOT NULL DEFAULT 0,
  version      TEXT NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE cards (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  canvas_id    TEXT NOT NULL,
  type         TEXT NOT NULL,
  x REAL, y REAL, width REAL, height REAL, z_index INTEGER,
  payload      TEXT NOT NULL,    -- JSON
  version      TEXT NOT NULL,
  deleted_at   INTEGER,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX cards_canvas ON cards(canvas_id) WHERE deleted_at IS NULL;

CREATE TABLE outbox (
  id             TEXT PRIMARY KEY,
  entity_type    TEXT NOT NULL,
  entity_id      TEXT NOT NULL,
  op             TEXT NOT NULL,
  patch          TEXT NOT NULL,
  client_version TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  retry_count    INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT
);
CREATE INDEX outbox_order ON outbox(created_at);

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE flush_snapshot (
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  snapshot    TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);
