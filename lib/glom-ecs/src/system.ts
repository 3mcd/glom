import type { SystemArgument } from "./system_argument"
import {
  type SystemDescriptor,
  system_descriptor_key,
} from "./system_descriptor"

export type System<T extends SystemArgument[] = SystemArgument[]> = (
  ...args: T
) => void

export type DefinedSystem<T extends SystemArgument[] = SystemArgument[]> = {
  readonly [system_descriptor_key]: SystemDescriptor<T>
} & System<T>

export function define_system<T extends SystemArgument[]>(
  system: System<T>,
  system_descriptor: SystemDescriptor<T>,
): asserts system is DefinedSystem<T> {
  Reflect.set(system, system_descriptor_key, system_descriptor)
}
