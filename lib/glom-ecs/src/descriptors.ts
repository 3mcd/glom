import type {ComponentLike} from "./component"
import type {Relation} from "./relation"

export type ReadDescriptor<T = unknown> = {
  read: ComponentLike
}
export type WriteDescriptor<T = unknown> = {
  write: ComponentLike
}
export type HasDescriptor<T extends ComponentLike = ComponentLike> = {
  has: T
}
export type NotDescriptor<T extends ComponentLike = ComponentLike> = {
  not: T
}
export type RelDescriptor<R extends Relation = Relation, T = unknown> = {
  rel: [R, T]
}
export type EntityDescriptor = {entity: true}
export type WorldDescriptor = {world: true}
export type SpawnDescriptor = {spawn: true}
export type DespawnDescriptor = {despawn: true}
export type AddDescriptor<T extends ComponentLike = ComponentLike> = {add: T}
export type RemoveDescriptor<T extends ComponentLike = ComponentLike> = {
  remove: T
}

export type InDescriptor<T extends AllDescriptor = AllDescriptor> = {
  in: T
}

export type OutDescriptor<T extends AllDescriptor = AllDescriptor> = {
  out: T
}

export type AllDescriptor<
  T0 = unknown,
  T1 = unknown,
  T2 = unknown,
  T3 = unknown,
  T4 = unknown,
  T5 = unknown,
  T6 = unknown,
  T7 = unknown,
> = {
  all: unknown[]
}

export function is_read_descriptor(desc: unknown): desc is ReadDescriptor {
  return (
    typeof desc === "object" &&
    desc !== null &&
    "read" in (desc as Record<string, unknown>)
  )
}

export function is_write_descriptor(desc: unknown): desc is WriteDescriptor {
  return (
    typeof desc === "object" &&
    desc !== null &&
    "write" in (desc as Record<string, unknown>)
  )
}

export function is_has_descriptor(desc: unknown): desc is HasDescriptor {
  return (
    typeof desc === "object" &&
    desc !== null &&
    "has" in (desc as Record<string, unknown>)
  )
}

export function is_not_descriptor(desc: unknown): desc is NotDescriptor {
  return (
    typeof desc === "object" &&
    desc !== null &&
    "not" in (desc as Record<string, unknown>)
  )
}

export function is_rel_descriptor(desc: unknown): desc is RelDescriptor {
  return (
    typeof desc === "object" &&
    desc !== null &&
    "rel" in (desc as Record<string, unknown>)
  )
}

export function is_entity_descriptor(desc: unknown): desc is EntityDescriptor {
  return (
    typeof desc === "object" &&
    desc !== null &&
    "entity" in (desc as Record<string, unknown>)
  )
}

export function is_world_descriptor(desc: unknown): desc is WorldDescriptor {
  return (
    typeof desc === "object" &&
    desc !== null &&
    "world" in (desc as Record<string, unknown>)
  )
}

export function is_spawn_descriptor(desc: unknown): desc is SpawnDescriptor {
  return (
    typeof desc === "object" &&
    desc !== null &&
    "spawn" in (desc as Record<string, unknown>)
  )
}

export function is_despawn_descriptor(
  desc: unknown,
): desc is DespawnDescriptor {
  return (
    typeof desc === "object" &&
    desc !== null &&
    "despawn" in (desc as Record<string, unknown>)
  )
}

export function is_add_descriptor(desc: unknown): desc is AddDescriptor {
  return (
    typeof desc === "object" &&
    desc !== null &&
    "add" in (desc as Record<string, unknown>)
  )
}

export function is_remove_descriptor(desc: unknown): desc is RemoveDescriptor {
  return (
    typeof desc === "object" &&
    desc !== null &&
    "remove" in (desc as Record<string, unknown>)
  )
}

export function is_all_descriptor(
  desc: unknown,
): desc is AllDescriptor<unknown> {
  return (
    typeof desc === "object" &&
    desc !== null &&
    "all" in (desc as Record<string, unknown>)
  )
}

export function is_in_descriptor(desc: unknown): desc is InDescriptor {
  return (
    typeof desc === "object" &&
    desc !== null &&
    "in" in (desc as Record<string, unknown>)
  )
}

export function is_out_descriptor(desc: unknown): desc is OutDescriptor {
  return (
    typeof desc === "object" &&
    desc !== null &&
    "out" in (desc as Record<string, unknown>)
  )
}
