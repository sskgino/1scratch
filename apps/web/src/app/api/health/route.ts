export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json({
    status: 'ok',
    service: '1scratch-web',
    time: new Date().toISOString(),
  })
}
