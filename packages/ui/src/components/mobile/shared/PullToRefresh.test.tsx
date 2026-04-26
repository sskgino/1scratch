import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PullToRefresh } from './PullToRefresh'

describe('PullToRefresh', () => {
  it('calls onRefresh when pulled past threshold', async () => {
    const onRefresh = vi.fn(async () => {})
    render(
      <PullToRefresh onRefresh={onRefresh}>
        <div data-testid="content" style={{ height: 400 }}>scroll</div>
      </PullToRefresh>,
    )
    const wrap = screen.getByTestId('content').parentElement!.parentElement!
    Object.defineProperty(wrap, 'scrollTop', { configurable: true, value: 0 })
    fireEvent.pointerDown(wrap, { clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(wrap, { clientY: 100, pointerId: 1 })
    fireEvent.pointerUp(wrap,   { clientY: 100, pointerId: 1 })
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  })
})
