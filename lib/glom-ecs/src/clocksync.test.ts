import {describe, expect, test} from "bun:test"
import {
  add_clocksync_sample,
  calculate_offset_and_rtt,
  get_consensus_offset,
  make_clocksync_manager,
} from "./clocksync"

describe("clocksync", () => {
  test("basic calculation math", () => {
    const sample = calculate_offset_and_rtt(100, 150, 120)
    expect(sample.rtt).toBe(20)
    expect(sample.offset).toBe(40)
  })

  test("smoothing with median filter", () => {
    const manager = make_clocksync_manager(5)

    add_clocksync_sample(manager, 0, 100, 200, 110)
    add_clocksync_sample(manager, 0, 200, 300, 210)
    add_clocksync_sample(manager, 0, 300, 1000, 400)
    add_clocksync_sample(manager, 0, 400, 500, 410)
    add_clocksync_sample(manager, 0, 500, 600, 510)

    const sync = manager.agents.get(0)!

    expect(sync.smoothed_rtt).toBe(10)

    expect(sync.smoothed_offset).toBe(95)
  })

  test("p2p consensus averaging", () => {
    const manager = make_clocksync_manager(5)

    add_clocksync_sample(manager, 1, 0, 105, 10)

    add_clocksync_sample(manager, 2, 0, -45, 10)

    expect(get_consensus_offset(manager)).toBe(25)
  })
})
