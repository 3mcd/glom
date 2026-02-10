import {assertDefined} from "./assert"
import type {ComponentInstance, ComponentLike} from "./component"
import type {Entity} from "./entity"
import {type AnyAll, isAll} from "./query/all"
import {makeAll, makeUnique, setupAll, teardownAll} from "./query/all_runtime"
import {MonitorRuntime, makeIn, makeOut} from "./query/monitor_runtime"
import {makeHas, makeNot, makeRead, makeWrite} from "./query/resource_runtime"
import type {System} from "./system"
import type {
  Add,
  Despawn,
  Remove,
  Spawn,
  SystemArgument,
} from "./system_argument"
import {
  isAddDescriptor,
  isAllDescriptor,
  isDespawnDescriptor,
  isHasDescriptor,
  isInDescriptor,
  isJoinDescriptor,
  isNotDescriptor,
  isOutDescriptor,
  isReadDescriptor,
  isRemoveDescriptor,
  isSpawnDescriptor,
  isUniqueDescriptor,
  isWorldDescriptor,
  isWriteDescriptor,
  type JoinDescriptor,
  type SystemDescriptor,
} from "./system_descriptor"
import type {World} from "./world"
import {addComponent, despawn, removeComponent, spawn} from "./world_api"

export type SystemExecutor<T extends SystemArgument[] = SystemArgument[]> = {
  readonly fn: System<T>
  readonly desc: SystemDescriptor<T>
  readonly args: T
}

export function makeSystemExecutor<
  T extends SystemArgument[] = SystemArgument[],
>(fn: System<T>, desc: SystemDescriptor<T>): SystemExecutor<T> {
  return {
    fn,
    desc,
    args: [] as unknown as T,
  }
}

export function runSystemExecutor<
  T extends SystemArgument[] = SystemArgument[],
>(exec: SystemExecutor<T>): void {
  exec.fn.apply(undefined, exec.args)
}

function isReactiveJoinDescriptor(desc: any): boolean {
  if (!isJoinDescriptor(desc)) return false
  const [left, right] = (desc as JoinDescriptor).join
  return (
    isInDescriptor(left) ||
    isOutDescriptor(left) ||
    isInDescriptor(right) ||
    isOutDescriptor(right) ||
    isReactiveJoinDescriptor(left) ||
    isReactiveJoinDescriptor(right)
  )
}

function getReactiveJoinMode(desc: any): "in" | "out" {
  if (isOutDescriptor(desc)) return "out"
  if (isInDescriptor(desc)) return "in"
  if (isJoinDescriptor(desc)) {
    const [left, right] = (desc as JoinDescriptor).join
    const leftMode = getReactiveJoinMode(left)
    if (leftMode === "out") return "out"
    const rightMode = getReactiveJoinMode(right)
    if (rightMode === "out") return "out"
  }
  return "in"
}

export function setupSystemExecutor<
  T extends SystemArgument[] = SystemArgument[],
>(exec: SystemExecutor<T>, world: World): void {
  const args = exec.args as SystemArgument[]
  for (let i = 0; i < exec.desc.params.length; i++) {
    const desc = exec.desc.params[i]
    assertDefined(desc)
    if (isReactiveJoinDescriptor(desc)) {
      const monitor = new MonitorRuntime(desc as any, getReactiveJoinMode(desc))
      setupAll(monitor, world)
      args[i] = monitor
    } else if (isAllDescriptor(desc) || isJoinDescriptor(desc)) {
      const all = makeAll(desc as any)
      setupAll(all, world)
      args[i] = all
    } else if (isUniqueDescriptor(desc)) {
      const unique = makeUnique(desc)
      setupAll(unique, world)
      args[i] = unique
    } else if (isInDescriptor(desc)) {
      const monitor = makeIn(desc)
      setupAll(monitor, world)
      args[i] = monitor
    } else if (isOutDescriptor(desc)) {
      const monitor = makeOut(desc)
      setupAll(monitor, world)
      args[i] = monitor
    } else if (isReadDescriptor(desc)) {
      args[i] = makeRead(desc, world)
    } else if (isWriteDescriptor(desc)) {
      args[i] = makeWrite(desc, world)
    } else if (isWorldDescriptor(desc)) {
      args[i] = world
    } else if (isHasDescriptor(desc)) {
      args[i] = makeHas(desc, world)
    } else if (isNotDescriptor(desc)) {
      args[i] = makeNot(desc, world)
    } else if (isSpawnDescriptor(desc)) {
      args[i] = ((
        ...components: (ComponentInstance<unknown> | ComponentLike)[]
      ) => spawn(world, ...components)) as unknown as Spawn
    } else if (isDespawnDescriptor(desc)) {
      args[i] = ((entity: Entity) =>
        despawn(world, entity)) as unknown as Despawn
    } else if (isAddDescriptor(desc)) {
      args[i] = ((entity: Entity, value: unknown) => {
        if (desc.add.isTag) {
          addComponent(world, entity, desc.add)
        } else {
          addComponent(world, entity, {component: desc.add, value})
        }
      }) as unknown as Add<ComponentLike>
    } else if (isRemoveDescriptor(desc)) {
      args[i] = ((entity: Entity) =>
        removeComponent(
          world,
          entity,
          desc.remove,
        )) as unknown as Remove<ComponentLike>
    }
  }
}

export function teardownSystemExecutor<
  T extends SystemArgument[] = SystemArgument[],
>(exec: SystemExecutor<T>): void {
  for (let i = 0; i < exec.args.length; i++) {
    const arg = exec.args[i]!
    if (isAll(arg)) {
      teardownAll(arg as AnyAll)
    }
  }
}

export function clearSystemExecutorMonitors(exec: SystemExecutor): void {
  for (let i = 0; i < exec.args.length; i++) {
    const arg = exec.args[i]
    if (arg instanceof MonitorRuntime) {
      arg.clear()
    }
  }
}
