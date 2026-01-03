import { assert_defined } from "../assert"
import type { Component } from "../component"
import { get_resource, type World } from "../world"
import type { Read, Write } from "./term"

export function make_read<T>(
  desc: { read: Component<T> },
  world: World,
): Read<Component<T>> {
  const value = get_resource(world, desc.read)
  assert_defined(value)
  return value as unknown as Read<Component<T>>
}

export function make_write<T>(
  desc: { write: Component<T> },
  world: World,
): Write<Component<T>> {
  const value = get_resource(world, desc.write)
  assert_defined(value)
  return value as unknown as Write<Component<T>>
}
