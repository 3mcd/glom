export type Timestep = {
  readonly hz: number
  readonly period: number
  accumulated: number
  lastTime: number
  offset: number
  maxDrift: number
  maxTicksPerUpdate: number
  initialized: boolean
}

export function makeTimestep(
  hz: number,
  maxDrift = 1000,
  maxTicksPerUpdate = 240,
): Timestep {
  return {
    hz,
    period: 1000 / hz,
    accumulated: 0,
    lastTime: 0,
    offset: 0,
    maxDrift,
    maxTicksPerUpdate,
    initialized: false,
  }
}

export function timestepUpdate(
  timestep: Timestep,
  nowLocal: number,
  onTick: (dt: number) => void,
) {
  const synchronizedNow = nowLocal + timestep.offset

  if (!timestep.initialized) {
    timestep.lastTime = synchronizedNow
    timestep.initialized = true
    return
  }

  let dt = synchronizedNow - timestep.lastTime

  if (Math.abs(dt) > timestep.maxDrift) {
    timestep.accumulated = 0
    dt = 0
  }

  timestep.accumulated += dt
  timestep.lastTime = synchronizedNow

  if (timestep.accumulated < 0) {
    timestep.accumulated = 0
  }

  let ticks = 0
  while (timestep.accumulated >= timestep.period) {
    onTick(timestep.period)
    timestep.accumulated -= timestep.period
    ticks++

    if (ticks >= timestep.maxTicksPerUpdate) {
      timestep.accumulated = 0
      break
    }
  }
}

export function timestepSetOffset(timestep: Timestep, offset: number) {
  timestep.offset = offset
}
