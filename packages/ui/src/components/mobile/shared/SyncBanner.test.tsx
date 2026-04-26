import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SyncBanner } from './SyncBanner'

describe('SyncBanner', () => {
  it('hides when state is hidden', () => {
    render(<SyncBanner state="hidden" />)
    expect(screen.queryByRole('status')).toBeNull()
  })
  it('shows offline copy when offline-saved', () => {
    render(<SyncBanner state="offline-saved" />)
    expect(screen.getByRole('status')).toHaveTextContent(/Offline/i)
  })
  it('shows reconnecting copy', () => {
    render(<SyncBanner state="reconnecting" />)
    expect(screen.getByRole('status')).toHaveTextContent(/Reconnecting/i)
  })
})
