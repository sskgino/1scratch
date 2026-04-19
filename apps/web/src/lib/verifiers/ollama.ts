// Ollama probe: GET {endpoint}/api/tags (+ optional Bearer token).
//
// SSRF defense (PLAN.md §2): server never probes private / link-local / loopback
// addresses — those are reachable only from the client, so the client does its
// own local probe and posts { status, models } to us. This server-side verifier
// only accepts publicly-routable Ollama endpoints (tunnels, Tailscale MagicDNS
// exit nodes, etc.). Callers fail soft to 'unverified' so the slot picker can
// still offer a "test from this device" button.

import { fetchWithTimeout, type VerifyResult } from './index'

// Hostnames / IPs we refuse to hit from the server.
const PRIVATE_HOSTS = new Set(['localhost', '0.0.0.0', 'host.docker.internal'])

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.')
  if (parts.length !== 4) return false
  const nums = parts.map((p) => Number.parseInt(p, 10))
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b] = nums as [number, number, number, number]
  if (a === 10) return true
  if (a === 127) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true                // link-local
  if (a === 100 && b >= 64 && b <= 127) return true      // CGNAT / Tailscale
  return false
}

function isPrivateIpv6(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === '::1') return true                            // loopback
  if (h.startsWith('fc') || h.startsWith('fd')) return true  // unique-local fc00::/7
  if (h.startsWith('fe80:')) return true                  // link-local
  return false
}

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase()
  if (PRIVATE_HOSTS.has(h)) return true
  if (h.endsWith('.local')) return true                   // mDNS
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return isPrivateIpv4(h)
  if (h.includes(':')) return isPrivateIpv6(h)
  return false
}

export function isServerVerifiable(endpointUrl: string): boolean {
  try {
    const u = new URL(endpointUrl)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    return !isBlockedHost(u.hostname)
  } catch {
    return false
  }
}

export async function verifyOllama(
  endpointUrl: string,
  bearerToken?: string,
): Promise<VerifyResult> {
  if (!isServerVerifiable(endpointUrl)) {
    return {
      status: 'unverified',
      models: [],
      error: 'client_side_only',
    }
  }
  const url = endpointUrl.replace(/\/$/, '') + '/api/tags'
  try {
    const headers: Record<string, string> = {}
    if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`
    const res = await fetchWithTimeout(url, { headers })
    if (res.status === 401 || res.status === 403) {
      return { status: 'invalid', models: [], error: `auth_${res.status}` }
    }
    if (!res.ok) {
      return { status: 'unverified', models: [], error: `http_${res.status}` }
    }
    const body = (await res.json()) as { models?: Array<{ name?: string }> }
    const models = (body.models ?? [])
      .map((m) => m.name)
      .filter((id): id is string => typeof id === 'string')
    return { status: 'connected', models }
  } catch (err) {
    return {
      status: 'unverified',
      models: [],
      error: err instanceof Error ? err.message : 'network_error',
    }
  }
}
