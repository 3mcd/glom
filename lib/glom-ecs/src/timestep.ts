export type Timestep = {
  readonly hz: number
  readonly period: number // ms per tick
  accumulated: number // ms
  last_time: number // ms (synchronized)
  offset: number // ms (local -> synchronized)
  max_drift: number // ms (reset threshold)
  max_ticks_per_update: number // spiral of death protection
  initialized: boolean
}

export function make_timestep(
  hz: number,
  max_drift = 1000,
  max_ticks_per_update = 240,
): Timestep {
  return {
    hz,
    period: 1000 / hz,
    accumulated: 0,
    last_time: 0,
    offset: 0,
    max_drift,
    max_ticks_per_update,
    initialized: false,
  }
}

/**
 * Updates the timestep and triggers ticks.
 * @param timestep The timestep state
 * @param now_local The current local time (e.g. performance.now())
 * @param on_tick Callback triggered for each fixed tick
 */
export function timestep_update(
  timestep: Timestep,
  now_local: number,
  on_tick: (dt: number) => void,
) {
  const synchronized_now = now_local + timestep.offset

  if (!timestep.initialized) {
    timestep.last_time = synchronized_now
    timestep.initialized = true
    return
  }

  let dt = synchronized_now - timestep.last_time

  // Detect massive time jumps (e.g. tab backgrounded, system sleep, or clock sync jump)
  if (Math.abs(dt) > timestep.max_drift) {
    timestep.accumulated = 0
    dt = 0
  }

  timestep.accumulated += dt
  timestep.last_time = synchronized_now

  // We don't support negative delta for accumulation
  if (timestep.accumulated < 0) {
    timestep.accumulated = 0
  }

  let ticks = 0
  while (timestep.accumulated >= timestep.period) {
    on_tick(timestep.period)
    timestep.accumulated -= timestep.period
    ticks++

    if (ticks >= timestep.max_ticks_per_update) {
      // Drop remaining time if we are too far behind
      timestep.accumulated = 0
      break
    }
  }
}

/**
 * Adjusts the clock offset. This is used by the ClockSync system.
 * Significant changes may trigger the max_drift reset in the next update.
 */
export function timestep_set_offset(timestep: Timestep, offset: number) {
  timestep.offset = offset
}
