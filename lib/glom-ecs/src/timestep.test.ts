import { describe, expect, test } from "bun:test"
import { make_timestep, timestep_set_offset, timestep_update } from "./timestep"

describe("timestep", () => {
  test("basic fixed update accumulation", () => {
    const ts = make_timestep(60) // 16.666... ms period
    let ticks = 0

    // First update initializes last_time
    timestep_update(ts, 0, () => ticks++)
    expect(ticks).toBe(0)

    // Advance 33.33ms (exactly 2 ticks at 60hz)
    timestep_update(ts, 33.4, () => ticks++)
    expect(ticks).toBe(2)
    expect(ts.accumulated).toBeCloseTo(0.06, 1) // Remaining tiny bit
  })

  test("reset on large time skip (max_drift)", () => {
    const ts = make_timestep(60, 500) // 500ms max drift
    let ticks = 0

    timestep_update(ts, 0, () => ticks++)

    // Advance 1000ms (more than 500ms drift)
    timestep_update(ts, 1000, () => ticks++)

    // Should have reset, so no ticks are fired for the jump itself
    expect(ticks).toBe(0)
    expect(ts.accumulated).toBe(0)

    // Subsequent normal update works
    timestep_update(ts, 1017, () => ticks++)
    expect(ticks).toBe(1)
  })

  test("spiral of death protection", () => {
    const ts = make_timestep(60, 2000, 10) // Allow 2000ms drift but max 10 ticks per update
    let ticks = 0

    timestep_update(ts, 0, () => ticks++)

    // Advance 1000ms (should be ~60 ticks)
    timestep_update(ts, 1000, () => ticks++)

    expect(ticks).toBe(10) // Capped
    expect(ts.accumulated).toBe(0) // Remainder dropped
  })

  test("offset adjustment for clock sync", () => {
    const ts = make_timestep(60)
    let ticks = 0

    timestep_update(ts, 1000, () => ticks++) // Init at synchronized 1000

    // Shift offset by +100ms (simulating server being ahead)
    timestep_set_offset(ts, 100)

    // Next update at local 1016ms -> synchronized 1116ms
    // Delta = 1116 - 1000 = 116ms (~6.96 ticks)
    timestep_update(ts, 1016, () => ticks++)

    expect(ticks).toBe(6)
  })
})
