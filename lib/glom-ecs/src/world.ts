import {type ClocksyncManager, makeClocksyncManager} from "./clocksync"
import {CommandBuffer, CommandEntity, CommandOf, IntentTick} from "./command"
import type {Component, ComponentInstance, ComponentLike} from "./component"
import {type Entity, RESOURCE_ENTITY} from "./entity"
import {
  type EntityGraph,
  type EntityGraphNode,
  makeEntityGraph,
} from "./entity_graph"
import {type EntityRegistry, makeEntityRegistry} from "./entity_registry"
import {HistoryBuffer, type UndoOp} from "./history"
import {type ComponentRegistry, makeComponentRegistry} from "./registry"
import {makeRelationRegistry, type RelationRegistry} from "./relation_registry"
import type {ReplicationOp} from "./replication"
import {
  IncomingSnapshots,
  IncomingTransactions,
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
  readonly resources: Set<number>
}

export function makeComponentStore(): ComponentStore {
  return {
    storage: new Map(),
    versions: new Map(),
    resources: new Set(),
  }
}

export type EntityIndex = {
  readonly entityToIndex: SparseMap<number>
  readonly indexToEntity: number[]
  readonly free: number[]
  next: number
}

export function makeEntityIndex(): EntityIndex {
  return {
    entityToIndex: makeSparseMap<number>(),
    indexToEntity: [],
    free: [],
    next: 1,
  }
}

export type GraphMove = {
  entity: Entity
  from?: EntityGraphNode
  to?: EntityGraphNode
}

export type World<R extends ComponentLike = any> = {
  readonly __resources: (val: R) => void
  readonly clocksync: ClocksyncManager
  readonly componentRegistry: ComponentRegistry
  readonly components: ComponentStore
  readonly graph: EntityGraph
  readonly graphChanges: SparseMap<GraphMove>
  readonly index: EntityIndex
  readonly pendingDeletions: Set<Entity>
  readonly pendingPrunes: Set<EntityGraphNode>
  readonly pendingOps: ReplicationOp[]
  readonly pendingRemovals: Map<Entity, ComponentLike[]>
  readonly registry: EntityRegistry
  readonly relations: RelationRegistry
  readonly transients: Map<number, {entity: Entity; tick: number}>
  readonly undoOps: UndoOp[]
  tick: number
  tickSpawnCount: number
}

export type WorldOptions = {
  domainId?: number
}

export function makeWorld(options: WorldOptions = {}): World {
  const {domainId = 0} = options

  const componentRegistry = makeComponentRegistry([
    Replicated,
    IntentTick,
    CommandOf,
    CommandEntity,
    ReplicationConfig,
    ReplicationStream,
    HistoryBuffer,
    CommandBuffer,
    IncomingTransactions,
    IncomingSnapshots,
  ])

  const world = {
    clocksync: makeClocksyncManager(),
    componentRegistry,
    components: makeComponentStore(),
    graph: makeEntityGraph(componentRegistry),
    graphChanges: makeSparseMap<GraphMove>(),
    index: makeEntityIndex(),
    pendingDeletions: new Set<Entity>(),
    pendingOps: [],
    pendingPrunes: new Set<EntityGraphNode>(),
    pendingRemovals: new Map<Entity, ComponentLike[]>(),
    registry: makeEntityRegistry(domainId),
    relations: makeRelationRegistry(),
    tick: 0,
    tickSpawnCount: 0,
    transients: new Map(),
    undoOps: [],
  } as unknown as World
  world.index.indexToEntity[0] = RESOURCE_ENTITY
  return world
}

export function getOrCreateIndex(world: World<any>, entity: number): number {
  if (entity === RESOURCE_ENTITY) {
    return 0
  }
  let index = sparseMapGet(world.index.entityToIndex, entity)
  if (index === undefined) {
    index = world.index.free.pop() ?? world.index.next++
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
  if (store === undefined) {
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
      world.components.resources.add(componentId)
    }
    return
  }
  const index = getOrCreateIndex(world, entity)

  let versions = world.components.versions.get(componentId)
  if (versions === undefined) {
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
  if (store !== undefined) {
    store[index] = value
  }
}

/**
 * Like setComponentValue but skips the version check, unconditionally
 * overwriting the current value. Used during authoritative snapshot
 * application where the server's value must always win.
 */
export function forceSetComponentValue<T>(
  world: World<any>,
  entity: number,
  component: Component<T> | ComponentLike,
  value: T,
  version = world.tick,
): void {
  const componentId = world.componentRegistry.getId(component)
  if (component.isTag) {
    if (entity === RESOURCE_ENTITY) {
      world.components.resources.add(componentId)
    }
    return
  }
  const index = getOrCreateIndex(world, entity)

  let versions = world.components.versions.get(componentId)
  if (versions === undefined) {
    versions = new Uint32Array(1024)
    world.components.versions.set(componentId, versions)
  }

  if (index >= versions.length) {
    const next = new Uint32Array(Math.max(versions.length * 2, index + 1))
    next.set(versions)
    versions = next
    world.components.versions.set(componentId, versions)
  }

  versions[index] = version

  const store = getComponentStore<T>(world, component)
  if (store !== undefined) {
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
  const pendingRemovals = world.pendingRemovals.get(entity as Entity)
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
      return world.components.resources.has(componentId)
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
  if (store === undefined) {
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
    world.components.resources.delete(componentId)
    return
  }
  const index =
    entity === RESOURCE_ENTITY
      ? 0
      : sparseMapGet(world.index.entityToIndex, entity)
  if (index !== undefined) {
    const store = getComponentStore<T>(world, component)
    if (store !== undefined) {
      store[index] = undefined
    }
  }
}

export function addResource<T extends ComponentLike, V>(
  world: World<T>,
  resource: ComponentInstance<V>,
): asserts world is World<T | Component<V>> {
  setComponentValue(world, RESOURCE_ENTITY, resource.component, resource.value)
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
    return world.components.resources.has(componentId)
  }
  const index = 0 // Resource entity is always index 0
  const store = world.components.storage.get(componentId)
  return store !== undefined && store[index] !== undefined
}

const DOMAIN_BITS = 11
const MAX_DOMAIN_ID = (1 << DOMAIN_BITS) - 1 // 2047

/**
 * Create a composite version from a tick and domainId.
 * Higher tick always wins; same-tick ties go to higher domainId.
 * Works with the existing `setComponentValue` version check
 * (`version < currentVersion`).
 */
export function makeVersion(tick: number, domainId: number): number {
  return tick * (MAX_DOMAIN_ID + 1) + domainId
}

/** Extract the tick from a composite version. */
export function getVersionTick(version: number): number {
  return Math.floor(version / (MAX_DOMAIN_ID + 1))
}

/** Extract the domainId from a composite version. */
export function getVersionDomainId(version: number): number {
  return version % (MAX_DOMAIN_ID + 1)
}

/**
 * Like setComponentValue but takes a raw componentId instead of a ComponentLike,
 * avoiding the allocation of a throwaway {id, __component_brand} object.
 * Assumes the component is NOT a tag (tags have no store).
 */
export function setComponentValueById(
  world: World<any>,
  entity: number,
  componentId: number,
  value: unknown,
  version = world.tick,
): void {
  const index = getOrCreateIndex(world, entity)

  let versions = world.components.versions.get(componentId)
  if (versions === undefined) {
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

  let store = world.components.storage.get(componentId)
  if (store === undefined) {
    store = []
    world.components.storage.set(componentId, store)
  }
  store[index] = value
}

/**
 * Like forceSetComponentValue but takes a raw componentId.
 * Unconditionally overwrites the current value (skips version check).
 */
export function forceSetComponentValueById(
  world: World<any>,
  entity: number,
  componentId: number,
  value: unknown,
  version = world.tick,
): void {
  const index = getOrCreateIndex(world, entity)

  let versions = world.components.versions.get(componentId)
  if (versions === undefined) {
    versions = new Uint32Array(1024)
    world.components.versions.set(componentId, versions)
  }

  if (index >= versions.length) {
    const next = new Uint32Array(Math.max(versions.length * 2, index + 1))
    next.set(versions)
    versions = next
    world.components.versions.set(componentId, versions)
  }

  versions[index] = version

  let store = world.components.storage.get(componentId)
  if (store === undefined) {
    store = []
    world.components.storage.set(componentId, store)
  }
  store[index] = value
}

/**
 * Like getComponentValue but takes a raw componentId.
 * Assumes the component is NOT a tag.
 */
export function getComponentValueById(
  world: World<any>,
  entity: number,
  componentId: number,
): unknown {
  if (world.pendingDeletions.has(entity as Entity)) {
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
  if (store === undefined) {
    return undefined
  }
  return store[index]
}

/** Get the numeric component ID for a component reference. */
export function getComponentId(world: World, comp: ComponentLike): number {
  return world.componentRegistry.getId(comp)
}

/** Resolve a numeric component ID back to a ComponentLike reference. */
export function resolveComponent(
  world: World,
  id: number,
): ComponentLike | undefined {
  return world.componentRegistry.getComponent(id)
}

/** Get the serde (encode/decode) for a component by its numeric ID. */
export function getComponentSerde(world: World, id: number) {
  return world.componentRegistry.getSerde(id)
}

/** Resolve a virtual component ID to its Component<void> reference. */
export function resolveVirtualComponent(world: World, vid: number) {
  return world.componentRegistry.getVirtualComponent(vid)
}

/** Allocate a new virtual component ID (used for relation instances). */
export function allocVirtualComponentId(world: World): number {
  return world.componentRegistry.allocVirtualId()
}

/** Get the entity graph node for a given entity. */
export function getEntityNode(
  world: World,
  entity: Entity,
): EntityGraphNode | undefined {
  return sparseMapGet(world.graph.byEntity, entity as number)
}
