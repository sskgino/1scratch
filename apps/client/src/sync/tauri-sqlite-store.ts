// Concrete Store impl on top of @tauri-apps/plugin-sql.
import Database from '@tauri-apps/plugin-sql'
import type {
  Store,
  StoredCard,
  StoredCanvas,
  StoredSection,
  Mutation,
} from '@1scratch/sync-engine'
import schemaSql from './schema.sql?raw'

export async function openSyncDb(): Promise<TauriSqliteStore> {
  const db = await Database.load('sqlite:sync.db')
  await runSchema(db)
  return new TauriSqliteStore(db)
}

async function runSchema(db: Database): Promise<void> {
  for (const stmt of splitStatements(schemaSql)) {
    if (stmt.trim()) await db.execute(stmt)
  }
}

function splitStatements(sql: string): string[] {
  return sql.split(';').map((s) => s.trim()).filter(Boolean).map((s) => s + ';')
}

export class TauriSqliteStore implements Store {
  constructor(private readonly db: Database) {}

  async listCards(workspaceId: string): Promise<StoredCard[]> {
    const rows = await this.db.select<CardRow[]>(
      'SELECT * FROM cards WHERE workspace_id = $1 AND deleted_at IS NULL',
      [workspaceId],
    )
    return rows.map(rowToCard)
  }
  async listCanvases(workspaceId: string): Promise<StoredCanvas[]> {
    const rows = await this.db.select<CanvasRow[]>(
      'SELECT * FROM canvases WHERE workspace_id = $1 ORDER BY position', [workspaceId])
    return rows.map(rowToCanvas)
  }
  async listSections(workspaceId: string): Promise<StoredSection[]> {
    const rows = await this.db.select<SectionRow[]>(
      'SELECT * FROM sections WHERE workspace_id = $1 ORDER BY position', [workspaceId])
    return rows.map(rowToSection)
  }

  async upsertCard(c: StoredCard) {
    await this.db.execute(
      `INSERT INTO cards (id, workspace_id, canvas_id, type, x, y, width, height, z_index,
         payload, version, deleted_at, updated_at)
       VALUES ($1,$2,$3,'card',$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT(id) DO UPDATE SET
         workspace_id=excluded.workspace_id, canvas_id=excluded.canvas_id,
         x=excluded.x, y=excluded.y, width=excluded.width, height=excluded.height,
         z_index=excluded.z_index, payload=excluded.payload, version=excluded.version,
         deleted_at=excluded.deleted_at, updated_at=excluded.updated_at`,
      [c.id, c.workspaceId, c.canvasId, c.x, c.y, c.width, c.height, c.zIndex,
       JSON.stringify(c.payload), c.version, c.deletedAt, Date.now()],
    )
  }
  async upsertCanvas(c: StoredCanvas) {
    await this.db.execute(
      `INSERT INTO canvases (id, workspace_id, section_id, name, color, viewport, position, version, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT(id) DO UPDATE SET
         section_id=excluded.section_id, name=excluded.name, color=excluded.color,
         viewport=excluded.viewport, position=excluded.position,
         version=excluded.version, updated_at=excluded.updated_at`,
      [c.id, c.workspaceId, c.sectionId, c.name, c.color,
       JSON.stringify(c.viewport), c.position, c.version, Date.now()],
    )
  }
  async upsertSection(s: StoredSection) {
    await this.db.execute(
      `INSERT INTO sections (id, workspace_id, name, color, position, permanent, version, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, color=excluded.color, position=excluded.position,
         permanent=excluded.permanent, version=excluded.version, updated_at=excluded.updated_at`,
      [s.id, s.workspaceId, s.name, s.color, s.position, s.permanent ? 1 : 0, s.version, Date.now()],
    )
  }
  async softDeleteCard(id: string, version: string) {
    await this.db.execute(
      'UPDATE cards SET deleted_at = $1, version = $2 WHERE id = $3',
      [Date.now(), version, id],
    )
  }
  async deleteCanvas(id: string) { await this.db.execute('DELETE FROM canvases WHERE id = $1', [id]) }
  async deleteSection(id: string) { await this.db.execute('DELETE FROM sections WHERE id = $1', [id]) }

  async enqueue(m: Mutation) {
    await this.db.execute(
      `INSERT INTO outbox (id, entity_type, entity_id, op, patch, client_version, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(id) DO NOTHING`,
      [m.id, m.entityType, m.entityId, m.op, JSON.stringify(m.patch), m.clientVersion, Date.now()],
    )
  }
  async peekOutbox(limit: number): Promise<Mutation[]> {
    const rows = await this.db.select<OutboxRow[]>(
      'SELECT * FROM outbox ORDER BY created_at LIMIT $1', [limit])
    return rows.map((r) => ({
      id: r.id,
      entityType: r.entity_type as Mutation['entityType'],
      entityId: r.entity_id,
      op: r.op as Mutation['op'],
      patch: JSON.parse(r.patch),
      clientVersion: r.client_version,
    }))
  }
  async removeFromOutbox(ids: string[]) {
    if (ids.length === 0) return
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',')
    await this.db.execute(`DELETE FROM outbox WHERE id IN (${placeholders})`, ids)
  }
  async outboxDepth() {
    const rows = await this.db.select<{ n: number }[]>('SELECT count(*) AS n FROM outbox')
    return rows[0]?.n ?? 0
  }
  async recordOutboxFailure(id: string, error: string) {
    await this.db.execute(
      'UPDATE outbox SET retry_count = retry_count + 1, last_error = $1 WHERE id = $2',
      [error.slice(0, 500), id],
    )
  }

  async getFlushSnapshot(et: string, id: string) {
    const rows = await this.db.select<{ snapshot: string }[]>(
      'SELECT snapshot FROM flush_snapshot WHERE entity_type = $1 AND entity_id = $2', [et, id])
    return rows[0] ? JSON.parse(rows[0].snapshot) : null
  }
  async setFlushSnapshot(et: string, id: string, snap: Record<string, unknown>) {
    await this.db.execute(
      `INSERT INTO flush_snapshot (entity_type, entity_id, snapshot) VALUES ($1,$2,$3)
       ON CONFLICT(entity_type, entity_id) DO UPDATE SET snapshot = excluded.snapshot`,
      [et, id, JSON.stringify(snap)],
    )
  }

  async getMeta(key: string) {
    const rows = await this.db.select<{ value: string }[]>('SELECT value FROM meta WHERE key = $1', [key])
    return rows[0]?.value ?? null
  }
  async setMeta(key: string, value: string) {
    await this.db.execute(
      `INSERT INTO meta (key, value) VALUES ($1,$2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value],
    )
  }
}

interface CardRow { id: string; workspace_id: string; canvas_id: string; x: number; y: number; width: number; height: number; z_index: number; payload: string; version: string; deleted_at: number | null }
interface CanvasRow { id: string; workspace_id: string; section_id: string; name: string; color: string | null; viewport: string; position: number; version: string }
interface SectionRow { id: string; workspace_id: string; name: string; color: string | null; position: number; permanent: number; version: string }
interface OutboxRow { id: string; entity_type: string; entity_id: string; op: string; patch: string; client_version: string; created_at: number }

function rowToCard(r: CardRow): StoredCard {
  return {
    id: r.id, workspaceId: r.workspace_id, canvasId: r.canvas_id,
    x: r.x, y: r.y, width: r.width, height: r.height, zIndex: r.z_index,
    payload: JSON.parse(r.payload), version: r.version, deletedAt: r.deleted_at,
  }
}
function rowToCanvas(r: CanvasRow): StoredCanvas {
  return {
    id: r.id, workspaceId: r.workspace_id, sectionId: r.section_id,
    name: r.name, color: r.color, viewport: JSON.parse(r.viewport),
    position: r.position, version: r.version,
  }
}
function rowToSection(r: SectionRow): StoredSection {
  return {
    id: r.id, workspaceId: r.workspace_id, name: r.name, color: r.color,
    position: r.position, permanent: r.permanent === 1, version: r.version,
  }
}
