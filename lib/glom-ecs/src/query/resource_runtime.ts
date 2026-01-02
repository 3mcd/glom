import type { World } from "../world"
import type { Read, Write } from "./term"

export function make_read<T>(_desc: { read: T }, _world: World): Read<any> {
  // Implementation pending: fetch from world
  return undefined as any
}

export function make_write<T>(_desc: { write: T }, _world: World): Write<any> {
  // Implementation pending: fetch from world
  return undefined as any
}
