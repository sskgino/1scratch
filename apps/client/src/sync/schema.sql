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

-- FTS5 (Phase 3b)
CREATE VIRTUAL TABLE cards_fts USING fts5(
  card_id UNINDEXED,
  content,
  canvas_name,
  section_name,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER cards_fts_ai AFTER INSERT ON cards BEGIN
  INSERT INTO cards_fts(card_id, content, canvas_name, section_name)
  VALUES (new.id,
          coalesce(json_extract(new.payload, '$.prompt'), '') || ' ' ||
          coalesce(json_extract(new.payload, '$.response'), ''),
          (SELECT name FROM canvases WHERE id = new.canvas_id),
          (SELECT s.name FROM sections s
             JOIN canvases c ON c.section_id = s.id
            WHERE c.id = new.canvas_id));
END;

CREATE TRIGGER cards_fts_au AFTER UPDATE ON cards BEGIN
  DELETE FROM cards_fts WHERE card_id = old.id;
  INSERT INTO cards_fts(card_id, content, canvas_name, section_name)
  VALUES (new.id,
          coalesce(json_extract(new.payload, '$.prompt'), '') || ' ' ||
          coalesce(json_extract(new.payload, '$.response'), ''),
          (SELECT name FROM canvases WHERE id = new.canvas_id),
          (SELECT s.name FROM sections s
             JOIN canvases c ON c.section_id = s.id
            WHERE c.id = new.canvas_id));
END;

CREATE TRIGGER cards_fts_ad AFTER DELETE ON cards BEGIN
  DELETE FROM cards_fts WHERE card_id = old.id;
END;
