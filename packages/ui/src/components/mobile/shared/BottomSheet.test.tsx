import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BottomSheet } from './BottomSheet'

describe('BottomSheet', () => {
  it('renders children when open', () => {
    render(<BottomSheet open onDismiss={() => {}}><p>hello</p></BottomSheet>)
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(<BottomSheet open={false} onDismiss={() => {}}><p>hello</p></BottomSheet>)
    expect(screen.queryByText('hello')).toBeNull()
  })

  it('calls onDismiss on backdrop click', () => {
    const onDismiss = vi.fn()
    render(<BottomSheet open onDismiss={onDismiss}><p>x</p></BottomSheet>)
    fireEvent.click(screen.getByTestId('bottom-sheet-backdrop'))
    expect(onDismiss).toHaveBeenCalled()
  })

  it('dismisses when dragged down past threshold', () => {
    const onDismiss = vi.fn()
    render(<BottomSheet open onDismiss={onDismiss}><p>x</p></BottomSheet>)
    const handle = screen.getByTestId('bottom-sheet-handle')
    fireEvent.pointerDown(handle, { clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientY: 250, pointerId: 1 })
    fireEvent.pointerUp(handle,   { clientY: 250, pointerId: 1 })
    expect(onDismiss).toHaveBeenCalled()
  })
})
