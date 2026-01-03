import { assert_defined } from "./assert"
import type { Component, ComponentLike } from "./component"
import type { DefinedSystem } from "./system"
import type { SystemArgument } from "./system_argument"
import {
  is_all_descriptor,
  is_has_descriptor,
  is_read_descriptor,
  is_rel_descriptor,
  is_write_descriptor,
  system_descriptor_key,
} from "./system_descriptor"
import {
  make_system_executor,
  run_system_executor,
  type SystemExecutor,
  setup_system_executor,
} from "./system_executor"
import type { World } from "./world"

enum SystemSchedulePhase {
  Setup,
  Run,
}

export type SystemSchedule<Requirements extends ComponentLike = never> = {
  __requirements?: (req: Requirements) => void
  execs: SystemExecutor[]
  phase: SystemSchedulePhase
}

type ExtractComponent<T> = T extends { readonly __read: infer C }
  ? C
  : T extends { readonly __write: infer C }
    ? C
    : T extends { readonly __has: infer C }
      ? C
      : T extends ComponentLike
        ? T
        : never

type SystemResources<T extends SystemArgument[]> = {
  [K in keyof T]: T[K] extends { readonly __all: true }
    ? never
    : ExtractComponent<T[K]>
}[number]

export function add_system<R extends ComponentLike, T extends SystemArgument[]>(
  schedule: SystemSchedule<R>,
  system: DefinedSystem<T>,
): asserts schedule is SystemSchedule<R | SystemResources<T>> {
  const executor = make_system_executor(system, system[system_descriptor_key])
  schedule.execs.push(executor as unknown as SystemExecutor)
}

export function make_system_schedule(): SystemSchedule<never> {
  return {
    execs: [] as SystemExecutor[],
    phase: SystemSchedulePhase.Setup,
  }
}

type NoInfer<T> = [T][T extends unknown ? 0 : never]

type SystemDeps = {
  reads: Set<number>
  writes: Set<number>
}

function extract_system_deps(exec: SystemExecutor): SystemDeps {
  const reads = new Set<number>()
  const writes = new Set<number>()

  function add_term_deps(term: unknown) {
    if (!term || typeof term !== "object") return

    if (is_read_descriptor(term)) {
      const c = term.read
      if (c && typeof c.id === "number") reads.add(c.id)
    } else if (is_write_descriptor(term)) {
      const c = term.write
      if (c && typeof c.id === "number") writes.add(c.id)
    } else if (is_has_descriptor(term)) {
      const c = term.has as Component<unknown>
      if (c && typeof c.id === "number") reads.add(c.id)
    } else if (is_rel_descriptor(term)) {
      const [rel, object] = term.rel
      if (rel && typeof rel.id === "number") reads.add(rel.id)
      add_term_deps(object)
    }
  }

  for (const param of exec.desc.params) {
    if (!param) continue
    if (is_all_descriptor(param)) {
      for (const term of param.all) {
        add_term_deps(term)
      }
    } else {
      add_term_deps(param)
    }
  }

  return { reads, writes }
}

function sort_systems(execs: SystemExecutor[]): SystemExecutor[] {
  const n = execs.length
  if (n <= 1) return execs

  const deps = execs.map(extract_system_deps)
  const adj: number[][] = Array.from({ length: n }, () => [])
  const in_degree = new Array(n).fill(0)

  const component_writers: Map<number, number[]> = new Map()
  const component_readers: Map<number, number[]> = new Map()

  for (let i = 0; i < n; i++) {
    const d = deps[i]
    assert_defined(d)
    for (const write_id of d.writes) {
      let writers = component_writers.get(write_id)
      if (!writers) {
        writers = []
        component_writers.set(write_id, writers)
      }
      writers.push(i)
    }
    for (const read_id of d.reads) {
      let readers = component_readers.get(read_id)
      if (!readers) {
        readers = []
        component_readers.set(read_id, readers)
      }
      readers.push(i)
    }
  }

  function add_edge(u: number, v: number) {
    const neighbors = adj[u]
    assert_defined(neighbors)
    if (!neighbors.includes(v)) {
      neighbors.push(v)
      in_degree[v]++
    }
  }

  for (const [component_id, writers] of component_writers.entries()) {
    // Rule 1: Writers in registration order
    for (let j = 0; j < writers.length - 1; j++) {
      const u = writers[j]
      const v = writers[j + 1]
      assert_defined(u)
      assert_defined(v)
      add_edge(u, v)
    }

    // Rule 2: All writers before all readers
    const readers = component_readers.get(component_id)
    if (readers) {
      for (const writer of writers) {
        for (const reader of readers) {
          add_edge(writer, reader)
        }
      }
    }
  }

  // Kahn's algorithm
  const queue: number[] = []
  for (let i = 0; i < n; i++) {
    if (in_degree[i] === 0) {
      queue.push(i)
    }
  }

  queue.sort((a, b) => a - b)

  const sorted_indices: number[] = []
  while (queue.length > 0) {
    const u = queue.shift()
    assert_defined(u)
    sorted_indices.push(u)

    const neighbors = adj[u]
    assert_defined(neighbors)
    for (const v of neighbors) {
      in_degree[v]--
      if (in_degree[v] === 0) {
        queue.push(v)
        queue.sort((a, b) => a - b)
      }
    }
  }

  if (sorted_indices.length !== n) {
    throw new Error("Cycle detected in system dependencies")
  }

  return sorted_indices.map((i) => {
    const exec = execs[i]
    assert_defined(exec)
    return exec
  })
}

export function run_schedule<T extends ComponentLike, U extends ComponentLike>(
  schedule: SystemSchedule<T>,
  world: World<U> & ([T] extends [NoInfer<U>] ? unknown : never),
): void {
  if (schedule.phase === SystemSchedulePhase.Setup) {
    schedule.execs = sort_systems(schedule.execs)
    for (const exec of schedule.execs) {
      setup_system_executor(exec, world as World)
    }
    schedule.phase = SystemSchedulePhase.Run
  }
  for (const exec of schedule.execs) {
    run_system_executor(exec)
  }
}
