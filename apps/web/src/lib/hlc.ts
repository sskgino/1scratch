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

// Advance local HLC to be strictly greater than `remote`. Called on each
// incoming client mutation so a client with a skewed-forward clock can't
// produce a version the server hasn't caught up to.
export function observeRemoteHlc(remote: bigint): void {
  const remoteTs = Number(remote >> 16n)
  if (remoteTs > lastTs) {
    lastTs = remoteTs
    counter = Number(remote & 0xffffn)
  } else if (remoteTs === lastTs) {
    const rCounter = Number(remote & 0xffffn)
    if (rCounter > counter) counter = rCounter
  }
}
