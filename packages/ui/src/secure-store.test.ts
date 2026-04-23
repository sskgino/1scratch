import { describe, it, expect, vi, beforeEach } from 'vitest'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

beforeEach(() => invokeMock.mockReset())

describe('secureStore', () => {
  it('get unwraps { value }', async () => {
    invokeMock.mockResolvedValue({ value: 'hello' })
    const { secureStore } = await import('./secure-store')
    expect(await secureStore.get('k')).toBe('hello')
    expect(invokeMock).toHaveBeenCalledWith('plugin:1scratch-secure-store|get', { args: { key: 'k' } })
  })

  it('get returns null when value is null', async () => {
    invokeMock.mockResolvedValue({ value: null })
    const { secureStore } = await import('./secure-store')
    expect(await secureStore.get('k')).toBeNull()
  })

  it('set forwards key + value', async () => {
    invokeMock.mockResolvedValue(undefined)
    const { secureStore } = await import('./secure-store')
    await secureStore.set('k', 'v')
    expect(invokeMock).toHaveBeenCalledWith('plugin:1scratch-secure-store|set', { args: { key: 'k', value: 'v' } })
  })

  it('has unwraps { value: bool }', async () => {
    invokeMock.mockResolvedValue({ value: true })
    const { secureStore } = await import('./secure-store')
    expect(await secureStore.has('k')).toBe(true)
  })
})
