import { assert_defined } from "./assert"
import { make_all } from "./query/all_runtime"
import { make_read, make_write } from "./query/resource_runtime"
import type { System } from "./system"
import type { SystemArgument } from "./system_argument"
import type { SystemDescriptor } from "./system_descriptor"
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
  for (let i = 0; i < exec.desc.params.length; i++) {
    const desc = exec.desc.params[i]
    assert_defined(desc)
    if ("all" in desc) {
      exec.args[i] = make_all(desc, world)
    } else if ("read" in desc) {
      exec.args[i] = make_read(desc, world)
    } else if ("write" in desc) {
      exec.args[i] = make_write(desc, world)
    }
  }
}
