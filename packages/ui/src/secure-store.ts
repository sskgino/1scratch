import { invoke } from '@tauri-apps/api/core'

export const secureStore = {
  async get(key: string): Promise<string | null> {
    const out = await invoke<{ value: string | null }>('plugin:1scratch-secure-store|get', { key })
    return out.value
  },
  async set(key: string, value: string): Promise<void> {
    await invoke<void>('plugin:1scratch-secure-store|set', { key, value })
  },
  async delete(key: string): Promise<void> {
    await invoke<void>('plugin:1scratch-secure-store|delete', { key })
  },
  async has(key: string): Promise<boolean> {
    const out = await invoke<{ value: boolean }>('plugin:1scratch-secure-store|has', { key })
    return out.value
  },
}
