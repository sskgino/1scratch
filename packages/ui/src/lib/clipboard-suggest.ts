import { useSettingsStore } from '../store/settings'

export interface SuggestionDescriptor {
  kind: 'url' | 'text'
  preview: string
  hash: string
}

const SEEN_KEY = '1scratch:clipboardSeen'

function djb2(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i)
  return (h >>> 0).toString(16)
}

function isUrl(s: string): boolean {
  try { new URL(s); return true } catch { return false }
}

export async function evaluateClipboard(): Promise<SuggestionDescriptor | null> {
  if (!useSettingsStore.getState().clipboardSuggestEnabled) return null
  let raw = ''
  try {
    const m = await import('@tauri-apps/plugin-clipboard-manager').catch(() => null)
    raw = m ? await m.readText() : ''
  } catch { return null }
  if (!raw) return null
  const trimmed = raw.trim()
  const url = isUrl(trimmed)
  if (!url && trimmed.length <= 20) return null
  const hash = djb2(trimmed)
  const seen: string[] = JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? '[]')
  if (seen.includes(hash)) return null
  return { kind: url ? 'url' : 'text', preview: trimmed, hash }
}

export function markSuggestionSeen(hash: string): void {
  const seen: string[] = JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? '[]')
  if (!seen.includes(hash)) seen.push(hash)
  sessionStorage.setItem(SEEN_KEY, JSON.stringify(seen))
}
