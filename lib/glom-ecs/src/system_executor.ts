import { assert_defined } from "./assert"
import { is_all } from "./query/all"
import { make_all, setup_all, teardown_all } from "./query/all_runtime"
import {
  make_has,
  make_not,
  make_read,
  make_write,
} from "./query/resource_runtime"
import type { System } from "./system"
import type { SystemArgument } from "./system_argument"
import {
  is_all_descriptor,
  is_has_descriptor,
  is_not_descriptor,
  is_read_descriptor,
  is_write_descriptor,
  type SystemDescriptor,
} from "./system_descriptor"
import type { World } from "./world"

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
    } else if (is_read_descriptor(desc)) {
      args[i] = make_read(desc, world)
    } else if (is_write_descriptor(desc)) {
      args[i] = make_write(desc, world)
    } else if (is_has_descriptor(desc)) {
      args[i] = make_has(desc, world)
    } else if (is_not_descriptor(desc)) {
      args[i] = make_not(desc, world)
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
