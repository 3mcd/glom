import {type ClockSyncManager, makeClocksyncManager} from "./clocksync"
import {CommandBuffer, CommandEntity, CommandOf, IntentTick} from "./command"
import type {Component, ComponentInstance, ComponentLike} from "./component"
import {type Entity, RESOURCE_ENTITY} from "./entity"
import {
  type EntityGraph,
  type EntityGraphNode,
  makeEntityGraph,
} from "./entity_graph"
import {type EntityRegistry, makeEntityRegistry} from "./entity_registry"
import {HistoryBuffer} from "./history"
import type {SnapshotMessage, Transaction} from "./net_types"
import {
  type ComponentRegistry,
  makeComponentRegistry,
  type RegistrySchema,
} from "./registry"
import {
  makeRelationRegistry,
  type RelationRegistry,
} from "./relation_registry"
import type {ReplicationOp} from "./replication"
import {
  IncomingSnapshots,
  IncomingTransactions,
  InputBuffer,
  Replicated,
  ReplicationConfig,
  ReplicationStream,
} from "./replication_config"

import {
  makeSparseMap,
  type SparseMap,
  sparseMapGet,
  sparseMapSet,
} from "./sparse_map"

export type ComponentStore = {
  readonly storage: Map<number, unknown[]>
  readonly versions: Map<number, Uint32Array>
  readonly resourceTags: Set<number>
}

export function makeComponentStore(): ComponentStore {
  return {
    storage: new Map(),
    versions: new Map(),
    resourceTags: new Set(),
  }
}

export type EntityIndex = {
  readonly entityToIndex: SparseMap<number>
  readonly indexToEntity: number[]
  readonly freeIndices: number[]
  nextIndex: number
}

export function makeEntityIndex(): EntityIndex {
  return {
    entityToIndex: makeSparseMap<number>(),
    indexToEntity: [],
    freeIndices: [],
    nextIndex: 1,
  }
}

export type GraphMove = {
  entity: Entity
  from?: EntityGraphNode
  to?: EntityGraphNode
}

export type Command = {
  target: Entity
  componentId: number
  data: unknown
  intentTick: number
}

export type World<R extends ComponentLike = any> = {
  readonly __resources: (val: R) => void
  readonly registry: EntityRegistry
  readonly componentRegistry: ComponentRegistry
  readonly entityGraph: EntityGraph
  readonly graphChanges: SparseMap<GraphMove>
  readonly pendingDeletions: Set<Entity>
  readonly pendingComponentRemovals: Map<Entity, ComponentLike[]>
  readonly pendingNodePruning: Set<EntityGraphNode>
  readonly components: ComponentStore
  readonly index: EntityIndex
  readonly relations: RelationRegistry
  tick: number
  tickSpawnCount: number
  readonly transientRegistry: Map<number, {entity: Entity; tick: number}>
  readonly pendingOps: ReplicationOp[]
  readonly clocksync: ClockSyncManager

  readonly _reduction_entity_to_ops: Map<Entity, ReplicationOp[]>
  readonly _reduction_component_changes: Map<number, ReplicationOp>
  readonly _reduction_component_removals: Set<number>
  readonly _batch_map: Map<number, unknown>
}

export type WorldOptions = {
  domainId?: number
  schema?: RegistrySchema | ComponentLike[]
}

export function makeWorld(options: WorldOptions = {}): World {
  const {domainId = 0, schema = {}} = options
  const normalizedSchema: RegistrySchema = Array.isArray(schema)
    ? {network: schema}
    : schema

  const componentRegistry = makeComponentRegistry(normalizedSchema, [
    Replicated,
    IntentTick,
    CommandOf,
    CommandEntity,
    ReplicationConfig,
    ReplicationStream,
    HistoryBuffer,
    CommandBuffer,
    InputBuffer,
    IncomingTransactions,
    IncomingSnapshots,
  ])

  const world = {
    registry: makeEntityRegistry(domainId),
    componentRegistry,
    entityGraph: makeEntityGraph(componentRegistry),
    graphChanges: makeSparseMap<GraphMove>(),
    pendingDeletions: new Set<Entity>(),
    pendingComponentRemovals: new Map<Entity, ComponentLike[]>(),
    pendingNodePruning: new Set<EntityGraphNode>(),
    components: makeComponentStore(),
    index: makeEntityIndex(),
    relations: makeRelationRegistry(),
    tick: 0,
    tickSpawnCount: 0,
    transientRegistry: new Map(),
    pendingOps: [],
    clocksync: makeClocksyncManager(),
    _reduction_entity_to_ops: new Map(),
    _reduction_component_changes: new Map(),
    _reduction_component_removals: new Set(),
    _batch_map: new Map(),
  } as unknown as World
  world.index.indexToEntity[0] = RESOURCE_ENTITY
  return world
}

export function worldGetOrCreateIndex(
  world: World<any>,
  entity: number,
): number {
  if (entity === RESOURCE_ENTITY) {
    return 0
  }
  let index = sparseMapGet(world.index.entityToIndex, entity)
  if (index === undefined) {
    index = world.index.freeIndices.pop() ?? world.index.nextIndex++
    sparseMapSet(world.index.entityToIndex, entity, index)
    world.index.indexToEntity[index] = entity
  }
  return index
}

export function getComponentStore<T>(
  world: World<any>,
  component: ComponentLike,
): (T | undefined)[] | undefined {
  if (component.isTag) {
    return undefined
  }
  const componentId = world.componentRegistry.getId(component)
  let store = world.components.storage.get(componentId)
  if (!store) {
    store = []
    world.components.storage.set(componentId, store)
  }
  return store as (T | undefined)[]
}

export function setComponentValue<T>(
  world: World<any>,
  entity: number,
  component: Component<T> | ComponentLike,
  value: T,
  version = world.tick,
): void {
  const componentId = world.componentRegistry.getId(component)
  if (component.isTag) {
    if (entity === RESOURCE_ENTITY) {
      world.components.resourceTags.add(componentId)
    }
    return
  }
  const index = worldGetOrCreateIndex(world, entity)

  let versions = world.components.versions.get(componentId)
  if (!versions) {
    versions = new Uint32Array(1024)
    world.components.versions.set(componentId, versions)
  }

  if (index >= versions.length) {
    const next = new Uint32Array(Math.max(versions.length * 2, index + 1))
    next.set(versions)
    versions = next
    world.components.versions.set(componentId, versions)
  }

  const currentVersion = versions[index]
  if (currentVersion !== undefined && version < currentVersion) {
    return
  }
  versions[index] = version

  const store = getComponentStore<T>(world, component)
  if (store) {
    store[index] = value
  }
}

export function getComponentValue<T>(
  world: World<any>,
  entity: number,
  component: Component<T> | ComponentLike,
): T | undefined {
  if (world.pendingDeletions.has(entity as Entity)) {
    return undefined
  }
  const pendingRemovals = world.pendingComponentRemovals.get(
    entity as Entity,
  )
  const componentId = world.componentRegistry.getId(component)
  if (
    pendingRemovals?.some(
      (c) => world.componentRegistry.getId(c) === componentId,
    )
  ) {
    return undefined
  }
  if (component.isTag) {
    if (entity === RESOURCE_ENTITY) {
      return world.components.resourceTags.has(componentId)
        ? (undefined as T)
        : undefined
    }

    return undefined
  }
  const index =
    entity === RESOURCE_ENTITY
      ? 0
      : sparseMapGet(world.index.entityToIndex, entity)
  if (index === undefined) {
    return undefined
  }
  const store = world.components.storage.get(componentId)
  if (!store) {
    return undefined
  }
  return store[index] as T | undefined
}

export function deleteComponentValue<T>(
  world: World<any>,
  entity: number,
  component: ComponentLike,
): void {
  const componentId = world.componentRegistry.getId(component)
  if (component.isTag && entity === RESOURCE_ENTITY) {
    world.components.resourceTags.delete(componentId)
    return
  }
  const index =
    entity === RESOURCE_ENTITY
      ? 0
      : sparseMapGet(world.index.entityToIndex, entity)
  if (index !== undefined) {
    const store = getComponentStore<T>(world, component)
    if (store) {
      store[index] = undefined
    }
  }
}

export function addResource<T extends ComponentLike, V>(
  world: World<T>,
  resource: ComponentInstance<V>,
): asserts world is World<T | Component<V>> {
  setComponentValue(
    world,
    RESOURCE_ENTITY,
    resource.component,
    resource.value,
  )
}

export function getResource<T extends ComponentLike, V>(
  world: World<T>,
  resource: Component<V>,
): V | undefined {
  return getComponentValue(world, RESOURCE_ENTITY, resource)
}

export function hasResource<T extends ComponentLike>(
  world: World<T>,
  resource: ComponentLike,
): boolean {
  const component = resource as Component<unknown>
  const componentId = world.componentRegistry.getId(component)
  if (component.isTag) {
    return world.components.resourceTags.has(componentId)
  }
  const index = 0 // Resource entity is always index 0
  const store = world.components.storage.get(componentId)
  return store !== undefined && store[index] !== undefined
}
