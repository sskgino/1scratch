import type { PushRequest, PushResponse, PullResponse } from '@1scratch/sync-proto'

export type HttpClientError =
  | { kind: 'network'; cause: unknown }
  | { kind: 'unauthorized' }
  | { kind: 'bad_request'; status: number; body: string }
  | { kind: 'server_error'; status: number; body: string }

export interface HttpClientOptions {
  baseUrl: string
  getAuthToken: () => Promise<string>
}

export class HttpClient {
  constructor(private readonly opts: HttpClientOptions) {}

  async push(body: PushRequest): Promise<PushResponse> {
    return this.request('/api/sync/push', { method: 'POST', body: JSON.stringify(body) })
  }

  async pull(since: string, limit: number): Promise<PullResponse> {
    const qs = new URLSearchParams({ since, limit: String(limit) })
    return this.request(`/api/sync/pull?${qs}`, { method: 'GET' })
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const token = await this.opts.getAuthToken()
    let res: Response
    try {
      res = await fetch(this.opts.baseUrl + path, {
        ...init,
        headers: {
          ...(init.headers ?? {}),
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      })
    } catch (cause) {
      throw Object.assign(new Error('network'), { kind: 'network', cause })
    }
    if (res.status === 401) throw Object.assign(new Error('401'), { kind: 'unauthorized' })
    const text = await res.text()
    if (res.status >= 400 && res.status < 500) {
      throw Object.assign(new Error(`${res.status}`), { kind: 'bad_request', status: res.status, body: text })
    }
    if (res.status >= 500) {
      throw Object.assign(new Error(`${res.status}`), { kind: 'server_error', status: res.status, body: text })
    }
    return JSON.parse(text) as T
  }
}
