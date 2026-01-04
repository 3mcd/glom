import {assert_defined} from "./assert"
import type {ComponentInstance, ComponentLike} from "./component"
import type {Entity} from "./entity"
import {is_all} from "./query/all"
import {make_all, setup_all, teardown_all} from "./query/all_runtime"
import {MonitorRuntime, make_in, make_out} from "./query/monitor_runtime"
import {
  make_has,
  make_not,
  make_read,
  make_write,
} from "./query/resource_runtime"
import type {System} from "./system"
import type {
  Add,
  Despawn,
  Remove,
  Spawn,
  SystemArgument,
} from "./system_argument"
import {
  is_add_descriptor,
  is_all_descriptor,
  is_despawn_descriptor,
  is_has_descriptor,
  is_in_descriptor,
  is_not_descriptor,
  is_out_descriptor,
  is_read_descriptor,
  is_remove_descriptor,
  is_spawn_descriptor,
  is_world_descriptor,
  is_write_descriptor,
  type SystemDescriptor,
} from "./system_descriptor"
import type {World} from "./world"
import {add_component, despawn, remove_component, spawn} from "./world_api"

export type SystemExecutor<T extends SystemArgument[] = SystemArgument[]> = {
  readonly fn: System<T>
  readonly desc: SystemDescriptor<T>
  readonly args: T
}

export function make_system_executor<
  T extends SystemArgument[] = SystemArgument[],
>(fn: System<T>, desc: SystemDescriptor<T>): SystemExecutor<T> {
  return {
    fn,
    desc,
    args: [] as unknown as T,
  }
}

export function run_system_executor<
  T extends SystemArgument[] = SystemArgument[],
>(exec: SystemExecutor<T>): void {
  exec.fn.apply(undefined, exec.args)
}

export function setup_system_executor<
  T extends SystemArgument[] = SystemArgument[],
>(exec: SystemExecutor<T>, world: World): void {
  const args = exec.args as SystemArgument[]
  for (let i = 0; i < exec.desc.params.length; i++) {
    const desc = exec.desc.params[i]
    assert_defined(desc)
    if (is_all_descriptor(desc)) {
      const all = make_all(desc)
      setup_all(all, world)
      args[i] = all
    } else if (is_in_descriptor(desc)) {
      const monitor = make_in(desc)
      setup_all(monitor, world)
      args[i] = monitor
    } else if (is_out_descriptor(desc)) {
      const monitor = make_out(desc)
      setup_all(monitor, world)
      args[i] = monitor
    } else if (is_read_descriptor(desc)) {
      args[i] = make_read(desc, world)
    } else if (is_write_descriptor(desc)) {
      args[i] = make_write(desc, world)
    } else if (is_world_descriptor(desc)) {
      args[i] = world
    } else if (is_has_descriptor(desc)) {
      args[i] = make_has(desc, world)
    } else if (is_not_descriptor(desc)) {
      args[i] = make_not(desc, world)
    } else if (is_spawn_descriptor(desc)) {
      args[i] = ((components: (ComponentInstance<unknown> | ComponentLike)[]) =>
        spawn(world, components)) as unknown as Spawn
    } else if (is_despawn_descriptor(desc)) {
      args[i] = ((entity: Entity) =>
        despawn(world, entity)) as unknown as Despawn
    } else if (is_add_descriptor(desc)) {
      const component = desc.add
      args[i] = ((entity: Entity, value: unknown) => {
        if (component.is_tag) {
          add_component(world, entity, component)
        } else {
          add_component(world, entity, {component, value})
        }
      }) as unknown as Add<ComponentLike>
    } else if (is_remove_descriptor(desc)) {
      const component = desc.remove
      args[i] = ((entity: Entity) =>
        remove_component(
          world,
          entity,
          component,
        )) as unknown as Remove<ComponentLike>
    }
  }
}

export function teardown_system_executor<
  T extends SystemArgument[] = SystemArgument[],
>(exec: SystemExecutor<T>): void {
  const args = exec.args as SystemArgument[]
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (is_all(arg)) {
      teardown_all(arg)
    }
  }
}

export function clear_system_executor_monitors(exec: SystemExecutor): void {
  const args = exec.args as SystemArgument[]
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg instanceof MonitorRuntime) {
      arg.clear()
    }
  }
}
