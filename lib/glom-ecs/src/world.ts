import type { Component, ComponentInstance, ComponentLike } from "./component"
import { RESOURCE_ENTITY } from "./entity"
import { type EntityGraph, make_entity_graph } from "./entity_graph"
import { type EntityRegistry, make_entity_registry } from "./entity_registry"
import {
  make_relation_registry,
  type RelationRegistry,
} from "./relation_registry"
import {
  make_sparse_map,
  type SparseMap,
  sparse_map_get,
  sparse_map_set,
} from "./sparse_map"

export type ComponentStore = {
  readonly storage: Map<number, unknown[]>
  readonly resource_tags: Set<number>
}

export function make_component_store(): ComponentStore {
  return {
    storage: new Map(),
    resource_tags: new Set(),
  }
}

export type EntityIndex = {
  readonly entity_to_index: SparseMap<number>
  readonly index_to_entity: number[]
  next_index: number
}

export function make_entity_index(): EntityIndex {
  return {
    entity_to_index: make_sparse_map<number>(),
    index_to_entity: [],
    next_index: 1, // Start at 1 to reserve index 0 for RESOURCE_ENTITY
  }
}

export type World<R extends ComponentLike = never> = {
  readonly __resources: (val: R) => void
  readonly registry: EntityRegistry
  readonly entity_graph: EntityGraph
  readonly components: ComponentStore
  readonly index: EntityIndex
  readonly relations: RelationRegistry
}

export function make_world(hi: number): World<never> {
  const world = {
    registry: make_entity_registry(hi),
    entity_graph: make_entity_graph(),
    components: make_component_store(),
    index: make_entity_index(),
    relations: make_relation_registry(),
  } as unknown as World<never>
  world.index.index_to_entity[0] = RESOURCE_ENTITY
  return world
}

export function world_get_or_create_index(
  world: World,
  entity: number,
): number {
  if (entity === RESOURCE_ENTITY) {
    return 0
  }
  let index = sparse_map_get(world.index.entity_to_index, entity)
  if (index === undefined) {
    index = world.index.next_index++
    sparse_map_set(world.index.entity_to_index, entity, index)
    world.index.index_to_entity[index] = entity
  }
  return index
}

export function get_component_store<T>(
  world: World,
  component: ComponentLike,
): (T | undefined)[] | undefined {
  if (component.is_tag) {
    return undefined
  }
  let store = world.components.storage.get(component.id)
  if (!store) {
    store = []
    world.components.storage.set(component.id, store)
  }
  return store as (T | undefined)[]
}

export function set_component_value<T>(
  world: World,
  entity: number,
  component: Component<T> | ComponentLike,
  value: T,
): void {
  if (component.is_tag && entity === RESOURCE_ENTITY) {
    world.components.resource_tags.add(component.id)
    return
  }
  const index = world_get_or_create_index(world, entity)
  const store = get_component_store<T>(world, component)
  if (store) {
    store[index] = value
  }
}

export function get_component_value<T>(
  world: World,
  entity: number,
  component: Component<T> | ComponentLike,
): T | undefined {
  if (component.is_tag) {
    if (entity === RESOURCE_ENTITY) {
      return world.components.resource_tags.has(component.id)
        ? (undefined as T)
        : undefined
    }
    // For regular entities, we don't have a way to check tags without graph logic yet.
    return undefined
  }
  const index =
    entity === RESOURCE_ENTITY
      ? 0
      : sparse_map_get(world.index.entity_to_index, entity)
  if (index === undefined) {
    return undefined
  }
  const store = world.components.storage.get(component.id)
  if (!store) {
    return undefined
  }
  return store[index] as T | undefined
}

export function delete_component_value<T>(
  world: World,
  entity: number,
  component: ComponentLike,
): void {
  if (component.is_tag && entity === RESOURCE_ENTITY) {
    world.components.resource_tags.delete(component.id)
    return
  }
  const index =
    entity === RESOURCE_ENTITY
      ? 0
      : sparse_map_get(world.index.entity_to_index, entity)
  if (index !== undefined) {
    const store = get_component_store<T>(world, component)
    if (store) {
      store[index] = undefined
    }
  }
}

export function add_resource<T extends ComponentLike, V>(
  world: World<T>,
  resource: ComponentInstance<V>,
): asserts world is World<T | Component<V>> {
  set_component_value(
    world,
    RESOURCE_ENTITY,
    resource.component,
    resource.value,
  )
}

export function get_resource<T extends ComponentLike, V>(
  world: World<T>,
  resource: Component<V>,
): V | undefined {
  return get_component_value(world, RESOURCE_ENTITY, resource)
}

export function has_resource<T extends ComponentLike>(
  world: World<T>,
  resource: ComponentLike,
): boolean {
  const component = resource as Component<unknown>
  if (component.is_tag) {
    return world.components.resource_tags.has(component.id)
  }
  const index = sparse_map_get(world.index.entity_to_index, RESOURCE_ENTITY)
  if (index === undefined) return false
  const store = world.components.storage.get(component.id)
  return store !== undefined && store[index] !== undefined
}
