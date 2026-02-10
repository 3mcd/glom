import {assertDefined} from "./assert"
import type {ComponentLike} from "./component"
import {
  isAddDescriptor,
  isAllDescriptor,
  isHasDescriptor,
  isReadDescriptor,
  isRemoveDescriptor,
  isWriteDescriptor,
  systemDescriptorKey,
} from "./system_descriptor"
import {
  clearSystemExecutorMonitors,
  makeSystemExecutor,
  runSystemExecutor,
  type SystemExecutor,
  setupSystemExecutor,
} from "./system_executor"
import type {World} from "./world"
import {flushDeletions, flushGraphChanges} from "./world_api"

enum SystemSchedulePhase {
  Setup,
  Run,
}

export type SystemSchedule<Requirements extends ComponentLike = never> = {
  __requirements?: (req: Requirements) => void
  execs: SystemExecutor<any>[]
  phase: SystemSchedulePhase
}

type ExtractComponent<T> = T extends {readonly __read: infer C}
  ? C
  : T extends {readonly __write: infer C}
    ? C
    : T extends {readonly __has: infer C}
      ? C
      : T extends {readonly __add: infer C}
        ? C
        : T extends {readonly __remove: infer C}
          ? C
          : never

type SystemResources<T extends any[]> = {
  [K in keyof T]: ExtractComponent<T[K]>
}[number]

export function addSystem<R extends ComponentLike, T extends any[]>(
  schedule: SystemSchedule<R>,
  system: (...args: T) => void,
): asserts schedule is SystemSchedule<R | SystemResources<T>> {
  const descriptor = Reflect.get(system, systemDescriptorKey)
  if (!descriptor) {
    return
  }
  const executor = makeSystemExecutor(system as any, descriptor)
  schedule.execs.push(executor as any)
}

export function makeSystemSchedule(): SystemSchedule<never> {
  return {
    execs: [] as SystemExecutor<any>[],
    phase: SystemSchedulePhase.Setup,
  }
}

type NoInfer<T> = [T][T extends unknown ? 0 : never]

type SystemDeps = {
  reads: Set<ComponentLike>
  writes: Set<ComponentLike>
}

function extractSystemDeps(exec: SystemExecutor): SystemDeps {
  const reads = new Set<ComponentLike>()
  const writes = new Set<ComponentLike>()

  function addTermDeps(term: unknown) {
    if (!term || typeof term !== "object") return

    if (isReadDescriptor(term)) {
      if (term.read) reads.add(term.read)
    } else if (isWriteDescriptor(term)) {
      if (term.write) writes.add(term.write)
    } else if (isAddDescriptor(term)) {
      if (term.add) writes.add(term.add)
    } else if (isRemoveDescriptor(term)) {
      if (term.remove) writes.add(term.remove)
    } else if (isHasDescriptor(term)) {
      if (term.has) reads.add(term.has as ComponentLike)
    }
  }

  for (const param of exec.desc.params) {
    if (!param) continue
    if (isAllDescriptor(param)) {
      for (const term of param.all) {
        addTermDeps(term)
      }
    } else {
      addTermDeps(param)
    }
  }

  return {reads, writes}
}

function sortSystems(execs: SystemExecutor[]): SystemExecutor[] {
  if (execs.length <= 1) return execs

  const deps = execs.map(extractSystemDeps)
  const adj: number[][] = Array.from({length: execs.length}, () => [])
  const inDegree = new Array(execs.length).fill(0)

  const componentWriters: Map<ComponentLike, number[]> = new Map()
  const componentReaders: Map<ComponentLike, number[]> = new Map()

  for (let i = 0; i < execs.length; i++) {
    const d = deps[i]
    assertDefined(d)
    for (const writeComp of d.writes) {
      let writers = componentWriters.get(writeComp)
      if (!writers) {
        writers = []
        componentWriters.set(writeComp, writers)
      }
      writers.push(i)
    }
    for (const readComp of d.reads) {
      let readers = componentReaders.get(readComp)
      if (!readers) {
        readers = []
        componentReaders.set(readComp, readers)
      }
      readers.push(i)
    }
  }

  function addEdge(u: number, v: number) {
    const neighbors = adj[u]
    assertDefined(neighbors)
    if (!neighbors.includes(v)) {
      neighbors.push(v)
      inDegree[v]++
    }
  }

  for (const [component, writers] of componentWriters.entries()) {
    for (let j = 0; j < writers.length - 1; j++) {
      const u = writers[j]
      const v = writers[j + 1]
      assertDefined(u)
      assertDefined(v)
      addEdge(u, v)
    }

    const readers = componentReaders.get(component)
    if (readers) {
      for (const writer of writers) {
        for (const reader of readers) {
          if (writer !== reader) {
            const readerDeps = deps[reader]
            if (readerDeps && !readerDeps.writes.has(component)) {
              addEdge(writer, reader)
            }
          }
        }
      }
    }
  }

  const queue: number[] = []
  for (let i = 0; i < execs.length; i++) {
    if (inDegree[i] === 0) {
      queue.push(i)
    }
  }

  queue.sort((a, b) => a - b)

  const sortedIndices: number[] = []
  while (queue.length > 0) {
    const u = queue.shift()
    assertDefined(u)
    sortedIndices.push(u)

    const neighbors = adj[u]
    assertDefined(neighbors)
    for (const v of neighbors) {
      inDegree[v]--
      if (inDegree[v] === 0) {
        queue.push(v)
        queue.sort((a, b) => a - b)
      }
    }
  }

  if (sortedIndices.length !== execs.length) {
    const visited = new Set<number>()
    const path: number[] = []
    const onPath = new Set<number>()
    let cycle: number[] = []

    function findCycle(u: number): boolean {
      visited.add(u)
      path.push(u)
      onPath.add(u)

      const neighbors = adj[u]
      if (neighbors) {
        for (const v of neighbors) {
          if (onPath.has(v)) {
            cycle = path.slice(path.indexOf(v))
            return true
          }
          if (!visited.has(v) && findCycle(v)) {
            return true
          }
        }
      }

      onPath.delete(u)
      path.pop()
      return false
    }

    for (let i = 0; i < execs.length; i++) {
      if (!visited.has(i) && findCycle(i)) {
        break
      }
    }

    const systemNames = cycle
      .map((i) => {
        const exec = execs[i]
        assertDefined(exec)
        return exec.desc.name || exec.fn.name || `anonymous_system_${i}`
      })
      .join(" -> ")

    throw new Error(`Cycle detected in system dependencies: ${systemNames}`)
  }

  return sortedIndices.map((i) => {
    const exec = execs[i]
    assertDefined(exec)
    return exec
  })
}

export function runSchedule<T extends ComponentLike, U extends ComponentLike>(
  schedule: SystemSchedule<T>,
  world: World<U> & ([T] extends [NoInfer<U>] ? unknown : never),
): void {
  if (schedule.phase === SystemSchedulePhase.Setup) {
    schedule.execs = sortSystems(schedule.execs)
    for (const exec of schedule.execs) {
      setupSystemExecutor(exec, world as World)
    }
    schedule.phase = SystemSchedulePhase.Run
  }
  for (const exec of schedule.execs) {
    runSystemExecutor(exec)
  }
  flushGraphChanges(world as World)
  flushDeletions(world as World)
  for (const exec of schedule.execs) {
    clearSystemExecutorMonitors(exec)
  }
}
