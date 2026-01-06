import {describe, expect, test} from "bun:test"
import {
  addClocksyncSample,
  calculateOffsetAndRtt,
  getConsensusOffset,
  makeClocksyncManager,
} from "./clocksync"

describe("clocksync", () => {
  test("basic calculation math", () => {
    const sample = calculateOffsetAndRtt(100, 150, 120)
    expect(sample.rtt).toBe(20)
    expect(sample.offset).toBe(40)
  })

  test("smoothing with median filter", () => {
    const manager = makeClocksyncManager(5)

    addClocksyncSample(manager, 0, 100, 200, 110)
    addClocksyncSample(manager, 0, 200, 300, 210)
    addClocksyncSample(manager, 0, 300, 1000, 400)
    addClocksyncSample(manager, 0, 400, 500, 410)
    addClocksyncSample(manager, 0, 500, 600, 510)

    const sync = manager.agents.get(0)!

    expect(sync.smoothedRtt).toBe(10)

    expect(sync.smoothedOffset).toBe(95)
  })

  test("p2p consensus averaging", () => {
    const manager = makeClocksyncManager(5)

    addClocksyncSample(manager, 1, 0, 105, 10)

    addClocksyncSample(manager, 2, 0, -45, 10)

    expect(getConsensusOffset(manager)).toBe(25)
  })
})
