import { describe, it, expect, beforeEach } from 'vitest'
import { useMobileNav } from './mobileNav'

describe('mobileNav store', () => {
  beforeEach(() => {
    localStorage.clear()
    useMobileNav.setState({ tab: 'capture', sheetStack: [] })
  })

  it('switches tabs', () => {
    useMobileNav.getState().setTab('library')
    expect(useMobileNav.getState().tab).toBe('library')
  })

  it('persists tab to localStorage', () => {
    useMobileNav.getState().setTab('you')
    expect(localStorage.getItem('1scratch:mobileNav.tab')).toBe('you')
  })

  it('pushes and pops sheets', () => {
    useMobileNav.getState().pushSheet({ id: 'a', kind: 'tab-switcher' })
    useMobileNav.getState().pushSheet({ id: 'b', kind: 'context-menu' })
    expect(useMobileNav.getState().sheetStack).toHaveLength(2)
    useMobileNav.getState().popSheet()
    expect(useMobileNav.getState().sheetStack).toHaveLength(1)
    expect(useMobileNav.getState().sheetStack[0]!.id).toBe('a')
  })
})
