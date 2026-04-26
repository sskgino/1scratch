import { describe, it, expect, vi } from 'vitest'
import { processCapturedImage } from './image-pipeline'

vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: vi.fn(async () => new Uint8Array([0xff, 0xd8, 0xff])),
  writeFile: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
}))
vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn(async () => '/tmp/app'),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}))

describe('image-pipeline', () => {
  it('returns full + thumb paths and dimensions', async () => {
    ;(globalThis as unknown as { createImageBitmap: unknown }).createImageBitmap = vi.fn(
      async () => ({ width: 4032, height: 3024, close: () => {} }),
    )
    class MockOC {
      width = 0
      height = 0
      constructor(w: number, h: number) { this.width = w; this.height = h }
      getContext() { return { drawImage: () => {} } }
      convertToBlob = vi.fn(async () => ({
        arrayBuffer: async () => new ArrayBuffer(1),
        type: 'image/jpeg',
      } as unknown as Blob))
    }
    ;(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = MockOC
    const r = await processCapturedImage('/tmp/raw.jpg', 'card-1')
    expect(r.fullPath).toContain('card-1.jpg')
    expect(r.thumbPath).toContain('card-1.thumb.jpg')
    expect(r.width).toBe(4032)
    expect(r.height).toBe(3024)
  })
})
