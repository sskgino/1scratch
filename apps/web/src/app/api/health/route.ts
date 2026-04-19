import { neon } from '@neondatabase/serverless'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    const sql = neon(url)
    const rows = (await sql`select now() as db_time`) as { db_time: string }[]
    return Response.json({
      status: 'ok',
      service: '1scratch-web',
      time: new Date().toISOString(),
      db_time: rows[0]?.db_time,
    })
  } catch (err) {
    return Response.json(
      {
        status: 'error',
        service: '1scratch-web',
        time: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    )
  }
}
