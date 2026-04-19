// Default workspace + "Imported" section bootstrap.
//
// New users don't have a workspace yet — Clerk's user.created webhook only
// inserts a `users` row. First canvas write (import, new-canvas, etc.)
// lazily materializes the default workspace and an "Imported" section.

import { sqlUser, withRls } from '@/db/rls'

export interface DefaultScope {
  workspaceId: string
  sectionId: string
}

interface WorkspaceRow {
  id: string
}

interface SectionRow {
  id: string
}

// Returns {workspaceId, sectionId} for a section named `sectionName` under
// the user's default workspace, creating either as needed. Idempotent.
export async function ensureDefaultWorkspaceAndSection(
  userId: string,
  sectionName = 'Imported',
): Promise<DefaultScope> {
  const sql = sqlUser()

  const [[workspace]] = await withRls<[WorkspaceRow[]]>(userId, [
    sql`SELECT id FROM workspaces
        WHERE user_id = ${userId}
        ORDER BY created_at ASC
        LIMIT 1`,
  ])

  let workspaceId: string
  if (workspace) {
    workspaceId = workspace.id
  } else {
    const [inserted] = await withRls<[WorkspaceRow[]]>(userId, [
      sql`INSERT INTO workspaces (user_id, name)
          VALUES (${userId}, 'My workspace')
          RETURNING id`,
    ])
    workspaceId = inserted[0]!.id
  }

  const [[section]] = await withRls<[SectionRow[]]>(userId, [
    sql`SELECT id FROM sections
        WHERE user_id = ${userId} AND workspace_id = ${workspaceId} AND name = ${sectionName}
        LIMIT 1`,
  ])

  let sectionId: string
  if (section) {
    sectionId = section.id
  } else {
    const [inserted] = await withRls<[SectionRow[]]>(userId, [
      sql`INSERT INTO sections (user_id, workspace_id, name, position)
          VALUES (${userId}, ${workspaceId}, ${sectionName}, 0)
          RETURNING id`,
    ])
    sectionId = inserted[0]!.id
  }

  return { workspaceId, sectionId }
}
