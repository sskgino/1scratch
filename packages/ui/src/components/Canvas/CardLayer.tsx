import { useCardsStore } from '../../store/cards'
import NoteCard from '../cards/NoteCard'

export default function CardLayer() {
  const { cards } = useCardsStore()
  return (
    <>
      {Object.values(cards).map((card) => (
        card.kind === 'prompt'
          ? <NoteCard key={card.id} card={card} />
          : null
      ))}
    </>
  )
}
