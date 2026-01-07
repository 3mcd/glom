import type {SystemArgument} from "./system_argument"
import {type SystemDescriptor, systemDescriptorKey} from "./system_descriptor"

export type System<T extends SystemArgument[]> = (...args: T) => void

export type DefinedSystem<T extends SystemArgument[]> = {
  readonly [systemDescriptorKey]: SystemDescriptor<T>
} & System<T>

export function defineSystem<T extends SystemArgument[]>(
  system: System<T>,
  systemDescriptor: SystemDescriptor<T>,
): DefinedSystem<T> {
  Reflect.set(system, systemDescriptorKey, systemDescriptor)
  return system as DefinedSystem<T>
}
