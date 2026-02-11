import {describe, expect, test} from "bun:test"
import * as Timestep from "./timestep"

describe("timestep", () => {
  test("basic fixed update accumulation", () => {
    const ts = Timestep.create(60)
    let ticks = 0

    Timestep.advance(ts, 0, () => ticks++)
    expect(ticks).toBe(0)

    Timestep.advance(ts, 33.4, () => ticks++)
    expect(ticks).toBe(2)
    expect(ts.accumulated).toBeCloseTo(0.06, 1)
  })

  test("reset on large time skip (maxDrift)", () => {
    const ts = Timestep.create(60, 500)
    let ticks = 0

    Timestep.advance(ts, 0, () => ticks++)

    Timestep.advance(ts, 1000, () => ticks++)

    expect(ticks).toBe(0)
    expect(ts.accumulated).toBe(0)

    Timestep.advance(ts, 1017, () => ticks++)
    expect(ticks).toBe(1)
  })

  test("spiral of death protection", () => {
    const ts = Timestep.create(60, 2000, 10)
    let ticks = 0

    Timestep.advance(ts, 0, () => ticks++)

    Timestep.advance(ts, 1000, () => ticks++)

    expect(ticks).toBe(10)
    expect(ts.accumulated).toBe(0)
  })

  test("offset adjustment for clock sync", () => {
    const ts = Timestep.create(60)
    let ticks = 0

    Timestep.advance(ts, 1000, () => ticks++)

    Timestep.setOffset(ts, 100)

    Timestep.advance(ts, 1016, () => ticks++)

    expect(ticks).toBe(6)
  })
})
