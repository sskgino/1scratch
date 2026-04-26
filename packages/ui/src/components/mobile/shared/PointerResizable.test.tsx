import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PointerResizable } from './PointerResizable'

describe('PointerResizable', () => {
  it('resizes via the handle', () => {
    const onSizeChange = vi.fn()
    render(
      <PointerResizable size={{ width: 100, height: 100 }} onSizeChange={onSizeChange} selected>
        <div>x</div>
      </PointerResizable>,
    )
    const handle = screen.getByTestId('resize-handle')
    fireEvent.pointerDown(handle, { clientX: 0,  clientY: 0,  pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 50, clientY: 30, pointerId: 1 })
    fireEvent.pointerUp(handle,   { clientX: 50, clientY: 30, pointerId: 1 })
    expect(onSizeChange).toHaveBeenLastCalledWith({ width: 150, height: 130 })
  })

  it('clamps to minWidth/minHeight', () => {
    const onSizeChange = vi.fn()
    render(
      <PointerResizable size={{ width: 100, height: 100 }} onSizeChange={onSizeChange} selected minWidth={80} minHeight={60}>
        <div>x</div>
      </PointerResizable>,
    )
    const handle = screen.getByTestId('resize-handle')
    fireEvent.pointerDown(handle, { clientX: 0,    clientY: 0,    pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: -200, clientY: -200, pointerId: 1 })
    expect(onSizeChange).toHaveBeenLastCalledWith({ width: 80, height: 60 })
  })

  it('hides handle when not selected', () => {
    render(
      <PointerResizable size={{ width: 100, height: 100 }} onSizeChange={() => {}} selected={false}>
        <div>x</div>
      </PointerResizable>,
    )
    expect(screen.queryByTestId('resize-handle')).toBeNull()
  })
})
