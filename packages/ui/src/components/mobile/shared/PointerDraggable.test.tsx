import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PointerDraggable } from './PointerDraggable'

describe('PointerDraggable', () => {
  it('reports position deltas via onPositionChange', () => {
    const onPositionChange = vi.fn()
    render(
      <PointerDraggable position={{ x: 0, y: 0 }} onPositionChange={onPositionChange}>
        <div data-testid="t" style={{ width: 100, height: 100 }} />
      </PointerDraggable>,
    )
    const t = screen.getByTestId('t').parentElement!
    fireEvent.pointerDown(t, { clientX: 0,  clientY: 0,  pointerId: 1 })
    fireEvent.pointerMove(t, { clientX: 30, clientY: 40, pointerId: 1 })
    fireEvent.pointerUp(t,   { clientX: 30, clientY: 40, pointerId: 1 })
    expect(onPositionChange).toHaveBeenLastCalledWith({ x: 30, y: 40 })
  })

  it('respects longPressMs — moving before timer cancels drag', () => {
    vi.useFakeTimers()
    const onDragStart = vi.fn()
    render(
      <PointerDraggable position={{ x: 0, y: 0 }} onPositionChange={() => {}} onDragStart={onDragStart} longPressMs={300}>
        <div data-testid="t" />
      </PointerDraggable>,
    )
    const t = screen.getByTestId('t').parentElement!
    fireEvent.pointerDown(t, { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(t, { clientX: 20, clientY: 0, pointerId: 1 })
    vi.advanceTimersByTime(400)
    expect(onDragStart).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('does not start when disabled', () => {
    const onPositionChange = vi.fn()
    render(
      <PointerDraggable position={{ x: 0, y: 0 }} onPositionChange={onPositionChange} disabled>
        <div data-testid="t" />
      </PointerDraggable>,
    )
    const t = screen.getByTestId('t').parentElement!
    fireEvent.pointerDown(t, { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(t, { clientX: 30, clientY: 40, pointerId: 1 })
    expect(onPositionChange).not.toHaveBeenCalled()
  })
})
