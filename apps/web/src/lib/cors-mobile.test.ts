import { describe, expect, it } from 'vitest'
import { applyCorsHeaders } from './cors-mobile'

describe('applyCorsHeaders', () => {
  for (const origin of ['http://tauri.localhost', 'https://tauri.localhost', 'tauri://localhost']) {
    it(`sets CORS headers for ${origin}`, () => {
      const h = new Headers()
      applyCorsHeaders(h, origin)
      expect(h.get('Access-Control-Allow-Origin')).toBe(origin)
      expect(h.get('Access-Control-Allow-Methods')).toBe('GET,POST,OPTIONS')
      expect(h.get('Access-Control-Allow-Headers')).toBe('authorization,content-type')
      expect(h.get('Vary')).toBe('Origin')
    })
  }

  it('does nothing for an unlisted origin', () => {
    const h = new Headers()
    applyCorsHeaders(h, 'https://evil.example.com')
    expect(h.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('does nothing when origin is null', () => {
    const h = new Headers()
    applyCorsHeaders(h, null)
    expect(h.get('Access-Control-Allow-Origin')).toBeNull()
  })
})
