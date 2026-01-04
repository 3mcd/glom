export type Timestep = {
  readonly hz: number
  readonly period: number
  accumulated: number
  last_time: number
  offset: number
  max_drift: number
  max_ticks_per_update: number
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

  if (Math.abs(dt) > timestep.max_drift) {
    timestep.accumulated = 0
    dt = 0
  }

  timestep.accumulated += dt
  timestep.last_time = synchronized_now

  if (timestep.accumulated < 0) {
    timestep.accumulated = 0
  }

  let ticks = 0
  while (timestep.accumulated >= timestep.period) {
    on_tick(timestep.period)
    timestep.accumulated -= timestep.period
    ticks++

    if (ticks >= timestep.max_ticks_per_update) {
      timestep.accumulated = 0
      break
    }
  }
}

export function timestep_set_offset(timestep: Timestep, offset: number) {
  timestep.offset = offset
}
