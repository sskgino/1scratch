import type { MemoryStrategy } from './types'

const strategies = new Map<string, MemoryStrategy>()

export function register(s: MemoryStrategy): void {
  strategies.set(s.id, s)
}

export function get(id: string): MemoryStrategy | undefined {
  return strategies.get(id)
}

export function list(): MemoryStrategy[] {
  return [...strategies.values()]
}

/** Test-only. Clears the registry between tests. */
export function clear(): void {
  strategies.clear()
}
