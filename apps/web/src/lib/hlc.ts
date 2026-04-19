// Hybrid Logical Clock encoding — (timestamp_ms << 16) | counter.
// See PLAN.md §3. 48 bits of ms timestamp + 16 bits of per-process counter
// fits comfortably in a Postgres bigint.

let lastTs = 0
let counter = 0

export function nextHlc(): bigint {
  const now = Date.now()
  if (now === lastTs) {
    counter = (counter + 1) & 0xffff
  } else {
    lastTs = now
    counter = 0
  }
  return (BigInt(now) << 16n) | BigInt(counter)
}
