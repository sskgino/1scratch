const FULL_MAX = 2048
const THUMB_MAX = 320

export interface ProcessedImage {
  fullPath: string
  thumbPath: string
  width: number
  height: number
}

function fitWithin(w: number, h: number, max: number): { w: number; h: number } {
  const long = Math.max(w, h)
  if (long <= max) return { w, h }
  const scale = max / long
  return { w: Math.round(w * scale), h: Math.round(h * scale) }
}

async function encode(bitmap: ImageBitmap, maxLong: number, quality: number): Promise<Blob> {
  const { w, h } = fitWithin(bitmap.width, bitmap.height, maxLong)
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable')
  ctx.drawImage(bitmap, 0, 0, w, h)
  return canvas.convertToBlob({ type: 'image/jpeg', quality })
}

export async function processCapturedImage(rawPath: string, cardId: string): Promise<ProcessedImage> {
  const fs = await import('@tauri-apps/plugin-fs')
  const path = await import('@tauri-apps/api/path')

  const bytes = await fs.readFile(rawPath)
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]))

  const fullBlob = await encode(bitmap, FULL_MAX, 0.85)
  const thumbBlob = await encode(bitmap, THUMB_MAX, 0.8)

  const dir = await path.join(await path.appDataDir(), 'images')
  const fullPath = await path.join(dir, `${cardId}.jpg`)
  const thumbPath = await path.join(dir, `${cardId}.thumb.jpg`)

  await fs.writeFile(fullPath, new Uint8Array(await fullBlob.arrayBuffer()))
  await fs.writeFile(thumbPath, new Uint8Array(await thumbBlob.arrayBuffer()))
  await fs.remove(rawPath).catch(() => {})

  const w = bitmap.width
  const h = bitmap.height
  bitmap.close?.()
  return { fullPath, thumbPath, width: w, height: h }
}
