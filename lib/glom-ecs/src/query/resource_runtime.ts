import {assertDefined} from "../assert"
import type {Component, ComponentLike} from "../component"
import type {
  HasDescriptor,
  NotDescriptor,
  ReadDescriptor,
  WriteDescriptor,
} from "../descriptors"
import {getComponentId, getResource, hasResource, type World} from "../world"
import type {Has, Not, Read, Write} from "./term"

export function makeRead<T>(
  desc: ReadDescriptor<T>,
  world: World,
): Read<ComponentLike> {
  const value = getResource(world, desc.read as Component<T>)
  assertDefined(value)
  return value as unknown as Read<ComponentLike>
}

export function makeWrite<T>(
  desc: WriteDescriptor<T>,
  world: World,
): Write<ComponentLike> {
  const value = getResource(world, desc.write as Component<T>)
  assertDefined(value)
  return value as unknown as Write<ComponentLike>
}

export function makeHas<T extends ComponentLike>(
  desc: HasDescriptor<T>,
  world: World,
): Has<T> {
  const exists = hasResource(world, desc.has)
  if (!exists) {
    throw new Error(
      `Resource ${getComponentId(world, desc.has)} not found`,
    )
  }
  return undefined as unknown as Has<T>
}

export function makeNot<T extends ComponentLike>(
  desc: NotDescriptor<T>,
  world: World,
): Not<T> {
  const exists = hasResource(world, desc.not)
  if (exists) {
    throw new Error(
      `Resource ${getComponentId(world, desc.not)} should not exist`,
    )
  }
  return undefined as unknown as Not<T>
}
