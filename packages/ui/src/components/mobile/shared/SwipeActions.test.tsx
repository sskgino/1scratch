import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SwipeActions } from './SwipeActions'

describe('SwipeActions', () => {
  it('fires left action onTrigger when swiped past threshold', () => {
    const onTrigger = vi.fn()
    render(
      <SwipeActions leftAction={{ label: 'Delete', color: '#f00', onTrigger }}>
        <div data-testid="row">row</div>
      </SwipeActions>,
    )
    const row = screen.getByTestId('row').parentElement!
    fireEvent.pointerDown(row, { clientX: 0,  pointerId: 1 })
    fireEvent.pointerMove(row, { clientX: 80, pointerId: 1 })
    fireEvent.pointerUp(row,   { clientX: 80, pointerId: 1 })
    expect(onTrigger).toHaveBeenCalled()
  })
})
