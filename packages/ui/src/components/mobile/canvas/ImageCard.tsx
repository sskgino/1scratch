import type { ImageCard as ImageCardType } from '../../../store/cards'

export interface ImageCardProps {
  card: ImageCardType
  deviceLabel?: string
}

export function ImageCard({ card, deviceLabel }: ImageCardProps) {
  const local = !!card.thumbPath
  if (!local) {
    return (
      <div style={{ padding: 12, background: '#f6f6f6', borderRadius: 8, color: '#666', fontSize: 13 }}>
        🖼 Image · captured on {deviceLabel ?? 'another device'} · {new Date(card.capturedAt).toLocaleString()}
      </div>
    )
  }
  return (
    <img
      src={`asset://localhost/${card.thumbPath}`}
      alt={card.caption ?? 'Captured image'}
      style={{ width: '100%', borderRadius: 8 }}
    />
  )
}
