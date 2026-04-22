import type { EmbedClient, DbClient } from './types'
import { LocalEmbedRequired } from './types'

/** In-memory fake for unit tests. Deterministic vectors = sum of char codes per token-ish bucket. */
export function makeFakeEmbedClient(dim = 8, modelId = 'test/fake-model'): EmbedClient {
  return {
    providerId: 'gateway',
    modelId,
    dim,
    async embed(texts: string[]): Promise<Float32Array[]> {
      return texts.map(t => {
        const arr = new Float32Array(dim)
        for (let i = 0; i < t.length; i++) {
          arr[i % dim] = (arr[i % dim] ?? 0) + t.charCodeAt(i) / 1000
        }
        return arr
      })
    },
  }
}

export { LocalEmbedRequired }
