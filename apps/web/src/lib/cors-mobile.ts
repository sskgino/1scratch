// Tauri WebView origins — Android/Windows use `{http|https}://tauri.localhost`
// (custom-protocol workaround); macOS/Linux desktop/iOS use `tauri://localhost`.
// Cross-origin fetches from the Tauri client to our Vercel API routes trigger
// CORS preflight; without these headers the WebView blocks the request.
export const TAURI_ORIGINS = new Set<string>([
  'http://tauri.localhost',
  'https://tauri.localhost',
  'tauri://localhost',
])

export function applyCorsHeaders(headers: Headers, origin: string | null): void {
  if (!origin || !TAURI_ORIGINS.has(origin)) return
  headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'authorization,content-type')
  headers.set('Access-Control-Max-Age', '86400')
  headers.set('Vary', 'Origin')
}
