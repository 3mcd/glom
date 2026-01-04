import {describe, expect, test} from "bun:test"
import {make_timestep, timestep_set_offset, timestep_update} from "./timestep"

describe("timestep", () => {
  test("basic fixed update accumulation", () => {
    const ts = make_timestep(60)
    let ticks = 0

    timestep_update(ts, 0, () => ticks++)
    expect(ticks).toBe(0)

    timestep_update(ts, 33.4, () => ticks++)
    expect(ticks).toBe(2)
    expect(ts.accumulated).toBeCloseTo(0.06, 1)
  })

  test("reset on large time skip (max_drift)", () => {
    const ts = make_timestep(60, 500)
    let ticks = 0

    timestep_update(ts, 0, () => ticks++)

    timestep_update(ts, 1000, () => ticks++)

    expect(ticks).toBe(0)
    expect(ts.accumulated).toBe(0)

    timestep_update(ts, 1017, () => ticks++)
    expect(ticks).toBe(1)
  })

  test("spiral of death protection", () => {
    const ts = make_timestep(60, 2000, 10)
    let ticks = 0

    timestep_update(ts, 0, () => ticks++)

    timestep_update(ts, 1000, () => ticks++)

    expect(ticks).toBe(10)
    expect(ts.accumulated).toBe(0)
  })

  test("offset adjustment for clock sync", () => {
    const ts = make_timestep(60)
    let ticks = 0

    timestep_update(ts, 1000, () => ticks++)

    timestep_set_offset(ts, 100)

    timestep_update(ts, 1016, () => ticks++)

    expect(ticks).toBe(6)
  })
})
