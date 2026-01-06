export type ClocksyncSample = {
  rtt: number
  offset: number
}

export type AgentSync = {
  readonly samples: ClocksyncSample[]
  smoothedRtt: number
  smoothedOffset: number
}

export type ClocksyncManager = {
  readonly agents: Map<number, AgentSync>
  readonly maxSamples: number
}

export function makeClocksyncManager(maxSamples = 16): ClocksyncManager {
  return {
    agents: new Map(),
    maxSamples,
  }
}

export function calculateOffsetAndRtt(
  t0: number,
  t1: number,
  t2: number,
): ClocksyncSample {
  const rtt = t2 - t0
  const latency = rtt / 2
  const offset = t1 - (t0 + latency)
  return {rtt, offset}
}

export function addClocksyncSample(
  manager: ClocksyncManager,
  agentId: number,
  t0: number,
  t1: number,
  t2: number,
) {
  let sync = manager.agents.get(agentId)
  if (!sync) {
    sync = {
      samples: [],
      smoothedRtt: 0,
      smoothedOffset: 0,
    }
    manager.agents.set(agentId, sync)
  }

  const sample = calculateOffsetAndRtt(t0, t1, t2)
  sync.samples.push(sample)

  if (sync.samples.length > manager.maxSamples) {
    sync.samples.shift()
  }

  const rtts = sync.samples.map((s) => s.rtt).sort((a, b) => a - b)
  const offsets = sync.samples.map((s) => s.offset).sort((a, b) => a - b)
  const mid = Math.floor(rtts.length / 2)

  if (rtts.length % 2 === 0) {
    sync.smoothedRtt = (rtts[mid - 1]! + rtts[mid]!) / 2
    sync.smoothedOffset = (offsets[mid - 1]! + offsets[mid]!) / 2
  } else {
    sync.smoothedRtt = rtts[mid]!
    sync.smoothedOffset = offsets[mid]!
  }
}

export function getConsensusOffset(manager: ClocksyncManager): number {
  if (manager.agents.size === 0) return 0

  let totalOffset = 0
  for (const sync of manager.agents.values()) {
    totalOffset += sync.smoothedOffset
  }

  return totalOffset / manager.agents.size
}

export function getAverageRtt(manager: ClocksyncManager): number {
  if (manager.agents.size === 0) return 0

  let totalRtt = 0
  for (const sync of manager.agents.values()) {
    totalRtt += sync.smoothedRtt
  }

  return totalRtt / manager.agents.size
}
