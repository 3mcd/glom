export type ClockSyncSample = {
  rtt: number
  offset: number
}

export type AgentSync = {
  readonly samples: ClockSyncSample[]
  smoothed_rtt: number
  smoothed_offset: number
}

export type ClockSyncManager = {
  readonly agents: Map<number, AgentSync>
  readonly max_samples: number
}

export function make_clocksync_manager(max_samples = 16): ClockSyncManager {
  return {
    agents: new Map(),
    max_samples,
  }
}

/**
 * Calculates RTT and Offset from NTP timestamps.
 * t0: local time message was sent
 * t1: remote time message was received
 * t2: local time response was received
 */
export function calculate_offset_and_rtt(
  t0: number,
  t1: number,
  t2: number,
): ClockSyncSample {
  const rtt = t2 - t0
  const latency = rtt / 2
  const offset = t1 - (t0 + latency)
  return { rtt, offset }
}

export function add_clocksync_sample(
  manager: ClockSyncManager,
  agent_id: number,
  t0: number,
  t1: number,
  t2: number,
) {
  let sync = manager.agents.get(agent_id)
  if (!sync) {
    sync = {
      samples: [],
      smoothed_rtt: 0,
      smoothed_offset: 0,
    }
    manager.agents.set(agent_id, sync)
  }

  const sample = calculate_offset_and_rtt(t0, t1, t2)
  sync.samples.push(sample)

  if (sync.samples.length > manager.max_samples) {
    sync.samples.shift()
  }

  // Smoothing: using median to filter out network jitter spikes
  const rtts = sync.samples.map((s) => s.rtt).sort((a, b) => a - b)
  const offsets = sync.samples.map((s) => s.offset).sort((a, b) => a - b)
  const mid = Math.floor(rtts.length / 2)

  if (rtts.length % 2 === 0) {
    sync.smoothed_rtt = (rtts[mid - 1]! + rtts[mid]!) / 2
    sync.smoothed_offset = (offsets[mid - 1]! + offsets[mid]!) / 2
  } else {
    sync.smoothed_rtt = rtts[mid]!
    sync.smoothed_offset = offsets[mid]!
  }
}

/**
 * Computes the consensus offset across all tracked agents.
 * In a server-authoritative setup, this will just be the server's offset.
 * In P2P, this will be the average of all tracked peers.
 */
export function get_consensus_offset(manager: ClockSyncManager): number {
  if (manager.agents.size === 0) return 0

  let total_offset = 0
  for (const sync of manager.agents.values()) {
    total_offset += sync.smoothed_offset
  }

  return total_offset / manager.agents.size
}

/**
 * Returns the average RTT across all agents.
 */
export function get_average_rtt(manager: ClockSyncManager): number {
  if (manager.agents.size === 0) return 0

  let total_rtt = 0
  for (const sync of manager.agents.values()) {
    total_rtt += sync.smoothed_rtt
  }

  return total_rtt / manager.agents.size
}

