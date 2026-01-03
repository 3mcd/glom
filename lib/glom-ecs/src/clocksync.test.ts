import { describe, expect, test } from "bun:test"
import {
  add_clocksync_sample,
  calculate_offset_and_rtt,
  get_consensus_offset,
  make_clocksync_manager,
} from "./clocksync"

describe("clocksync", () => {
  test("basic calculation math", () => {
    // Local sends at 100, remote receives at 150, local receives back at 120
    // RTT = 120 - 100 = 20
    // Latency = 10
    // Expected Remote time at receive = 100 + 10 = 110
    // Offset = 150 - 110 = +40
    const sample = calculate_offset_and_rtt(100, 150, 120)
    expect(sample.rtt).toBe(20)
    expect(sample.offset).toBe(40)
  })

  test("smoothing with median filter", () => {
    const manager = make_clocksync_manager(5)
    
    // Add samples with a jitter spike
    add_clocksync_sample(manager, 0, 100, 200, 110) // RTT 10, Offset 95
    add_clocksync_sample(manager, 0, 200, 300, 210) // RTT 10, Offset 95
    add_clocksync_sample(manager, 0, 300, 1000, 400) // RTT 100 (SPIKE), Offset 650 (SPIKE)
    add_clocksync_sample(manager, 0, 400, 500, 410) // RTT 10, Offset 95
    add_clocksync_sample(manager, 0, 500, 600, 510) // RTT 10, Offset 95

    const sync = manager.agents.get(0)!
    // Median of [10, 10, 10, 10, 100] is 10
    expect(sync.smoothed_rtt).toBe(10)
    // Median of [95, 95, 95, 95, 650] is 95
    expect(sync.smoothed_offset).toBe(95)
  })

  test("p2p consensus averaging", () => {
    const manager = make_clocksync_manager(5)
    
    // Agent 1 is ahead by 100ms
    add_clocksync_sample(manager, 1, 0, 105, 10) // RTT 10, Offset 100
    
    // Agent 2 is behind by 50ms
    add_clocksync_sample(manager, 2, 0, -45, 10) // RTT 10, Offset -50
    
    // Consensus should be (100 + -50) / 2 = 25ms
    expect(get_consensus_offset(manager)).toBe(25)
  })
})

