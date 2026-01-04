import { type ClockSyncManager, make_clocksync_manager } from "./clocksync"
import { CommandEntity, CommandOf, IntentTick } from "./command"
import type { Component, ComponentInstance, ComponentLike } from "./component"
import { type Entity, RESOURCE_ENTITY } from "./entity"
import {
  type EntityGraph,
  type EntityGraphNode,
  make_entity_graph,
} from "./entity_graph"
import { type EntityRegistry, make_entity_registry } from "./entity_registry"
import type { HistoryBuffer } from "./history"
import type { SnapshotMessage } from "./net_types"
import {
  type ComponentRegistry,
  make_component_registry,
  type RegistrySchema,
} from "./registry"
import {
  make_relation_registry,
  type RelationRegistry,
} from "./relation_registry"
import type {
  ReplicationOp,
  ReplicationRecorder,
  Transaction,
} from "./replication"
import { Replicated, ReplicationConfig } from "./replication_config"

export type SnapshotEmitter = (message: SnapshotMessage) => void

import {
  make_sparse_map,
  type SparseMap,
  sparse_map_get,
  sparse_map_set,
} from "./sparse_map"

export type ComponentStore = {
  readonly storage: Map<number, unknown[]>
  readonly versions: Map<number, Uint32Array>
  readonly resource_tags: Set<number>
}

export function make_component_store(): ComponentStore {
  return {
    storage: new Map(),
    versions: new Map(),
    resource_tags: new Set(),
  }
}

export type EntityIndex = {
  readonly entity_to_index: SparseMap<number>
  readonly index_to_entity: number[]
  readonly free_indices: number[]
  next_index: number
}

export function make_entity_index(): EntityIndex {
  return {
    entity_to_index: make_sparse_map<number>(),
    index_to_entity: [],
    free_indices: [],
    next_index: 1, // Start at 1 to reserve index 0 for RESOURCE_ENTITY
  }
}

export type GraphMove = {
  entity: Entity
  from?: EntityGraphNode
  to?: EntityGraphNode
}

export type World<R extends ComponentLike = any> = {
  readonly __resources: (val: R) => void
  readonly registry: EntityRegistry
  readonly component_registry: ComponentRegistry
  readonly entity_graph: EntityGraph
  readonly graph_changes: SparseMap<GraphMove>
  readonly pending_deletions: Set<Entity>
  readonly pending_component_removals: Map<Entity, ComponentLike[]>
  readonly pending_node_pruning: Set<EntityGraphNode>
  readonly components: ComponentStore
  readonly index: EntityIndex
  readonly relations: RelationRegistry
  recorder?: ReplicationRecorder
  snapshot_emitter?: SnapshotEmitter
  tick: number
  tick_spawn_count: number
  readonly transient_registry: Map<number, { entity: Entity; tick: number }>
  readonly pending_ops: ReplicationOp[]
  history?: HistoryBuffer
  readonly input_buffer: Map<number, unknown>
  readonly remote_transactions: Map<number, Transaction[]>
  readonly remote_snapshots: Map<number, SnapshotMessage[]>
  readonly clocksync: ClockSyncManager
  readonly command_buffer: Map<
    number,
    {
      target: Entity
      component_id: number
      data: unknown
      intent_tick: number
    }[]
  >
  // Reusable buffers to avoid allocations in hot paths
  readonly _reduction_entity_to_ops: Map<Entity, ReplicationOp[]>
  readonly _reduction_component_changes: Map<number, ReplicationOp>
  readonly _reduction_component_removals: Set<number>
  readonly _batch_map: Map<number, unknown>
}

export function make_world(
  hi: number,
  schema: RegistrySchema | ComponentLike[] = {},
  recorder?: ReplicationRecorder,
): World {
  const normalized_schema: RegistrySchema = Array.isArray(schema)
    ? { network: schema }
    : schema

  const component_registry = make_component_registry(normalized_schema, [
    Replicated,
    IntentTick,
    CommandOf,
    CommandEntity,
    ReplicationConfig,
  ])

  const world = {
    registry: make_entity_registry(hi),
    component_registry,
    entity_graph: make_entity_graph(component_registry),
    graph_changes: make_sparse_map<GraphMove>(),
    pending_deletions: new Set<Entity>(),
    pending_component_removals: new Map<Entity, ComponentLike[]>(),
    pending_node_pruning: new Set<EntityGraphNode>(),
    components: make_component_store(),
    index: make_entity_index(),
    relations: make_relation_registry(),
    recorder,
    tick: 0,
    tick_spawn_count: 0,
    transient_registry: new Map(),
    pending_ops: [],
    input_buffer: new Map(),
    remote_transactions: new Map(),
    remote_snapshots: new Map(),
    clocksync: make_clocksync_manager(),
    command_buffer: new Map(),
    _reduction_entity_to_ops: new Map(),
    _reduction_component_changes: new Map(),
    _reduction_component_removals: new Set(),
    _batch_map: new Map(),
  } as unknown as World
  world.index.index_to_entity[0] = RESOURCE_ENTITY
  return world
}

export function world_get_or_create_index(
  world: World<any>,
  entity: number,
): number {
  if (entity === RESOURCE_ENTITY) {
    return 0
  }
  let index = sparse_map_get(world.index.entity_to_index, entity)
  if (index === undefined) {
    index = world.index.free_indices.pop() ?? world.index.next_index++
    sparse_map_set(world.index.entity_to_index, entity, index)
    world.index.index_to_entity[index] = entity
  }
  return index
}

export function get_component_store<T>(
  world: World<any>,
  component: ComponentLike,
): (T | undefined)[] | undefined {
  if (component.is_tag) {
    return undefined
  }
  const component_id = world.component_registry.get_id(component)
  let store = world.components.storage.get(component_id)
  if (!store) {
    store = []
    world.components.storage.set(component_id, store)
  }
  return store as (T | undefined)[]
}

export function set_component_value<T>(
  world: World<any>,
  entity: number,
  component: Component<T> | ComponentLike,
  value: T,
  version = world.tick,
): void {
  const component_id = world.component_registry.get_id(component)
  if (component.is_tag) {
    if (entity === RESOURCE_ENTITY) {
      world.components.resource_tags.add(component_id)
    }
    return
  }
  const index = world_get_or_create_index(world, entity)

  // Last-Write-Wins check
  let versions = world.components.versions.get(component_id)
  if (!versions) {
    versions = new Uint32Array(1024) // Initial capacity
    world.components.versions.set(component_id, versions)
  }

  // Ensure versions array is large enough
  if (index >= versions.length) {
    const next = new Uint32Array(Math.max(versions.length * 2, index + 1))
    next.set(versions)
    versions = next
    world.components.versions.set(component_id, versions)
  }

  const current_version = versions[index]
  if (current_version !== undefined && version < current_version) {
    return
  }
  versions[index] = version

  const store = get_component_store<T>(world, component)
  if (store) {
    store[index] = value
  }
}

export function get_component_value<T>(
  world: World<any>,
  entity: number,
  component: Component<T> | ComponentLike,
): T | undefined {
  if (world.pending_deletions.has(entity as Entity)) {
    return undefined
  }
  const pending_removals = world.pending_component_removals.get(
    entity as Entity,
  )
  const component_id = world.component_registry.get_id(component)
  if (
    pending_removals?.some(
      (c) => world.component_registry.get_id(c) === component_id,
    )
  ) {
    return undefined
  }
  if (component.is_tag) {
    if (entity === RESOURCE_ENTITY) {
      return world.components.resource_tags.has(component_id)
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
  const store = world.components.storage.get(component_id)
  if (!store) {
    return undefined
  }
  return store[index] as T | undefined
}

export function delete_component_value<T>(
  world: World<any>,
  entity: number,
  component: ComponentLike,
): void {
  const component_id = world.component_registry.get_id(component)
  if (component.is_tag && entity === RESOURCE_ENTITY) {
    world.components.resource_tags.delete(component_id)
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
    return world.components.resource_tags.has(
      world.component_registry.get_id(component),
    )
  }
  const index = sparse_map_get(world.index.entity_to_index, RESOURCE_ENTITY)
  if (index === undefined) return false
  const store = world.components.storage.get(
    world.component_registry.get_id(component),
  )
  return store !== undefined && store[index] !== undefined
}
