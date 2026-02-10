import type {ComponentLike} from "./component"
import type {Relation} from "./relation"

export type ReadDescriptor<_T = unknown> = {
  read: ComponentLike
}
export type WriteDescriptor<_T = unknown> = {
  write: ComponentLike
}
export type HasDescriptor<T extends ComponentLike = ComponentLike> = {
  has: T
}
export type NotDescriptor<T extends ComponentLike = ComponentLike> = {
  not: T
}
export type EntityDescriptor = {entity: true}
export type WorldDescriptor = {world: true}
export type SpawnDescriptor<T extends ComponentLike = any> = {
  spawn: T | true
}
export type DespawnDescriptor = {despawn: true}
export type AddDescriptor<T extends ComponentLike = ComponentLike> = {add: T}
export type RemoveDescriptor<T extends ComponentLike = ComponentLike> = {
  remove: T
}

export type InDescriptor<T extends AllDescriptor | JoinDescriptor = any> = {
  in: T
}

export type OutDescriptor<T extends AllDescriptor | JoinDescriptor = any> = {
  out: T
}

export type UniqueDescriptor<
  _T0 = any,
  _T1 = any,
  _T2 = any,
  _T3 = any,
  _T4 = any,
  _T5 = any,
  _T6 = any,
  _T7 = any,
> = {
  unique: unknown[]
}

export type AllDescriptor<
  _T0 = any,
  _T1 = any,
  _T2 = any,
  _T3 = any,
  _T4 = any,
  _T5 = any,
  _T6 = any,
  _T7 = any,
> = {
  all: unknown[]
}

export type JoinDescriptor<
  L extends AllDescriptor | InDescriptor | OutDescriptor = any,
  R extends AllDescriptor | InDescriptor | OutDescriptor = any,
  Rel extends Relation | undefined = undefined,
> = {
  join: [L, R, Rel]
}

export function isReadDescriptor(desc: unknown): desc is ReadDescriptor {
  return (
    typeof desc === "object" &&
    desc !== null &&
    "read" in (desc as Record<string, unknown>)
  )
}

export function isWriteDescriptor(desc: unknown): desc is WriteDescriptor {
  return (
    typeof desc === "object" &&
    desc !== null &&
    "write" in (desc as Record<string, unknown>)
  )
}

export function isHasDescriptor(desc: unknown): desc is HasDescriptor {
  return (
    typeof desc === "object" &&
    desc !== null &&
    "has" in (desc as Record<string, unknown>)
  )
}

export function isNotDescriptor(desc: unknown): desc is NotDescriptor {
  return (
    typeof desc === "object" &&
    desc !== null &&
    "not" in (desc as Record<string, unknown>)
  )
}

export function isEntityDescriptor(desc: unknown): desc is EntityDescriptor {
  return (
    typeof desc === "object" &&
    desc !== null &&
    "entity" in (desc as Record<string, unknown>)
  )
}

export function isWorldDescriptor(desc: unknown): desc is WorldDescriptor {
  return (
    typeof desc === "object" &&
    desc !== null &&
    "world" in (desc as Record<string, unknown>)
  )
}

export function isSpawnDescriptor(desc: unknown): desc is SpawnDescriptor {
  return (
    typeof desc === "object" &&
    desc !== null &&
    "spawn" in (desc as Record<string, unknown>)
  )
}

export function isDespawnDescriptor(desc: unknown): desc is DespawnDescriptor {
  return (
    typeof desc === "object" &&
    desc !== null &&
    "despawn" in (desc as Record<string, unknown>)
  )
}

export function isAddDescriptor(desc: unknown): desc is AddDescriptor {
  return (
    typeof desc === "object" &&
    desc !== null &&
    "add" in (desc as Record<string, unknown>)
  )
}

export function isRemoveDescriptor(desc: unknown): desc is RemoveDescriptor {
  return (
    typeof desc === "object" &&
    desc !== null &&
    "remove" in (desc as Record<string, unknown>)
  )
}

export function isAllDescriptor(desc: unknown): desc is AllDescriptor<unknown> {
  return (
    typeof desc === "object" &&
    desc !== null &&
    "all" in (desc as Record<string, unknown>)
  )
}

export function isUniqueDescriptor(
  desc: unknown,
): desc is UniqueDescriptor<unknown> {
  return (
    typeof desc === "object" &&
    desc !== null &&
    "unique" in (desc as Record<string, unknown>)
  )
}

export function isJoinDescriptor(desc: unknown): desc is JoinDescriptor {
  return (
    typeof desc === "object" &&
    desc !== null &&
    "join" in (desc as Record<string, unknown>)
  )
}

export function isInDescriptor(desc: unknown): desc is InDescriptor {
  return (
    typeof desc === "object" &&
    desc !== null &&
    "in" in (desc as Record<string, unknown>)
  )
}

export function isOutDescriptor(desc: unknown): desc is OutDescriptor {
  return (
    typeof desc === "object" &&
    desc !== null &&
    "out" in (desc as Record<string, unknown>)
  )
}
