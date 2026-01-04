import {assert_defined} from "./assert"
import type {ComponentLike} from "./component"
import type {DefinedSystem} from "./system"
import type {SystemArgument} from "./system_argument"
import {
  is_add_descriptor,
  is_all_descriptor,
  is_has_descriptor,
  is_read_descriptor,
  is_rel_descriptor,
  is_remove_descriptor,
  is_write_descriptor,
  system_descriptor_key,
} from "./system_descriptor"
import {
  clear_system_executor_monitors,
  make_system_executor,
  run_system_executor,
  type SystemExecutor,
  setup_system_executor,
} from "./system_executor"
import type {World} from "./world"
import {world_flush_deletions, world_flush_graph_changes} from "./world_api"

enum SystemSchedulePhase {
  Setup,
  Run,
}

export type SystemSchedule<Requirements extends ComponentLike = never> = {
  __requirements?: (req: Requirements) => void
  execs: SystemExecutor[]
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
          : T extends ComponentLike
            ? T
            : never

type SystemResources<T extends SystemArgument[]> = {
  [K in keyof T]: T[K] extends {readonly __all: true}
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
  reads: Set<ComponentLike>
  writes: Set<ComponentLike>
}

function extract_system_deps(exec: SystemExecutor): SystemDeps {
  const reads = new Set<ComponentLike>()
  const writes = new Set<ComponentLike>()

  function add_term_deps(term: unknown) {
    if (!term || typeof term !== "object") return

    if (is_read_descriptor(term)) {
      const c = term.read
      if (c) reads.add(c)
    } else if (is_write_descriptor(term)) {
      const c = term.write
      if (c) writes.add(c)
    } else if (is_add_descriptor(term)) {
      const c = term.add
      if (c) writes.add(c)
    } else if (is_remove_descriptor(term)) {
      const c = term.remove
      if (c) writes.add(c)
    } else if (is_has_descriptor(term)) {
      const c = term.has as ComponentLike
      if (c) reads.add(c)
    } else if (is_rel_descriptor(term)) {
      const [rel, object] = term.rel
      if (rel) reads.add(rel as ComponentLike)
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

  return {reads, writes}
}

function sort_systems(execs: SystemExecutor[]): SystemExecutor[] {
  const n = execs.length
  if (n <= 1) return execs

  const deps = execs.map(extract_system_deps)
  const adj: number[][] = Array.from({length: n}, () => [])
  const in_degree = new Array(n).fill(0)

  const component_writers: Map<ComponentLike, number[]> = new Map()
  const component_readers: Map<ComponentLike, number[]> = new Map()

  for (let i = 0; i < n; i++) {
    const d = deps[i]
    assert_defined(d)
    for (const write_comp of d.writes) {
      let writers = component_writers.get(write_comp)
      if (!writers) {
        writers = []
        component_writers.set(write_comp, writers)
      }
      writers.push(i)
    }
    for (const read_comp of d.reads) {
      let readers = component_readers.get(read_comp)
      if (!readers) {
        readers = []
        component_readers.set(read_comp, readers)
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

  for (const [component, writers] of component_writers.entries()) {
    // Rule 1: Writers in registration order
    for (let j = 0; j < writers.length - 1; j++) {
      const u = writers[j]
      const v = writers[j + 1]
      assert_defined(u)
      assert_defined(v)
      add_edge(u, v)
    }

    // Rule 2: All writers before all readers (excluding readers that are also writers)
    const readers = component_readers.get(component)
    if (readers) {
      for (const writer of writers) {
        for (const reader of readers) {
          if (writer !== reader) {
            const reader_deps = deps[reader]
            if (reader_deps && !reader_deps.writes.has(component)) {
              add_edge(writer, reader)
            }
          }
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
    // Detect cycle for better error message
    const visited = new Set<number>()
    const path: number[] = []
    const on_path = new Set<number>()
    let cycle: number[] = []

    function find_cycle(u: number): boolean {
      visited.add(u)
      path.push(u)
      on_path.add(u)

      const neighbors = adj[u]
      if (neighbors) {
        for (const v of neighbors) {
          if (on_path.has(v)) {
            cycle = path.slice(path.indexOf(v))
            return true
          }
          if (!visited.has(v) && find_cycle(v)) {
            return true
          }
        }
      }

      on_path.delete(u)
      path.pop()
      return false
    }

    for (let i = 0; i < n; i++) {
      if (!visited.has(i) && find_cycle(i)) {
        break
      }
    }

    const system_names = cycle
      .map((i) => {
        const exec = execs[i]
        assert_defined(exec)
        return exec.desc.name || exec.fn.name || `anonymous_system_${i}`
      })
      .join(" -> ")

    throw new Error(`Cycle detected in system dependencies: ${system_names}`)
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
  world_flush_graph_changes(world as World)
  world_flush_deletions(world as World)
  for (const exec of schedule.execs) {
    clear_system_executor_monitors(exec)
  }
}
