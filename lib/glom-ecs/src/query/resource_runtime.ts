import { assert_defined } from "../assert"
import type { Component, ComponentLike } from "../component"
import type {
  HasDescriptor,
  NotDescriptor,
  ReadDescriptor,
  WriteDescriptor,
} from "../descriptors"
import { get_resource, has_resource, type World } from "../world"
import type { Has, Not, Read, Write } from "./term"

export function make_read<T>(
  desc: ReadDescriptor<T>,
  world: World,
): Read<ComponentLike> {
  const value = get_resource(world, desc.read as Component<T>)
  assert_defined(value)
  return value as unknown as Read<ComponentLike>
}

export function make_write<T>(
  desc: WriteDescriptor<T>,
  world: World,
): Write<ComponentLike> {
  const value = get_resource(world, desc.write as Component<T>)
  assert_defined(value)
  return value as unknown as Write<ComponentLike>
}

export function make_has<T extends ComponentLike>(
  desc: HasDescriptor<T>,
  world: World,
): Has<T> {
  const exists = has_resource(world, desc.has)
  if (!exists) {
    throw new Error(`Resource ${desc.has.id} not found`)
  }
  return undefined as unknown as Has<T>
}

export function make_not<T extends ComponentLike>(
  desc: NotDescriptor<T>,
  world: World,
): Not<T> {
  const exists = has_resource(world, desc.not)
  if (exists) {
    throw new Error(`Resource ${desc.not.id} should not exist`)
  }
  return undefined as unknown as Not<T>
}
