import { describe, it, expect, vi, beforeEach } from 'vitest'
import { evaluateClipboard, markSuggestionSeen } from './clipboard-suggest'
import { useSettingsStore } from '../store/settings'

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  readText: vi.fn(async () => 'https://example.com'),
}))

describe('clipboard-suggest', () => {
  beforeEach(() => {
    useSettingsStore.setState({ clipboardSuggestEnabled: true })
    sessionStorage.clear()
  })

  it('returns URL suggestion for a URL', async () => {
    const r = await evaluateClipboard()
    expect(r).toEqual({
      kind: 'url',
      preview: 'https://example.com',
      hash: expect.any(String),
    })
  })

  it('returns null when disabled', async () => {
    useSettingsStore.setState({ clipboardSuggestEnabled: false })
    expect(await evaluateClipboard()).toBeNull()
  })

  it('dedups within session', async () => {
    const a = await evaluateClipboard()
    expect(a).not.toBeNull()
    markSuggestionSeen(a!.hash)
    expect(await evaluateClipboard()).toBeNull()
  })

  it('rejects short non-URL text', async () => {
    const m = await import('@tauri-apps/plugin-clipboard-manager')
    vi.mocked(m.readText).mockResolvedValueOnce('hi')
    expect(await evaluateClipboard()).toBeNull()
  })
})
