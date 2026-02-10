import type {Component, ComponentLike} from "./component"
import {defineComponent} from "./component"
import {type Entity, getDomainId} from "./entity"
import {
  type EntityGraphNode,
  entityGraphFindOrCreateNode,
  entityGraphNodeAddEntity,
  entityGraphNodeAddRelation,
  entityGraphNodeRemoveEntity,
} from "./entity_graph"
import {getDomain, removeEntity} from "./entity_registry"
import {addDomainEntity} from "./entity_registry_domain"
import {ByteReader, ByteWriter} from "./lib/binary"
import type {SpawnComponent} from "./net_types"
import {
  getOrCreateVirtualMap,
  type RelationPair,
  type RelationSubject,
  registerIncomingRelation,
  setRelationPair,
} from "./relation_registry"
import {
  sparseMapClear,
  sparseMapDelete,
  sparseMapForEach,
  sparseMapGet,
  sparseMapSet,
} from "./sparse_map"
import {sparseSetAdd, sparseSetClear, sparseSetSize} from "./sparse_set"
import {makeVec, type Vec, vecDifference, vecSum} from "./vec"
import {
  deleteComponentValue,
  getComponentSerde,
  getEntityNode,
  getOrCreateIndex,
  resolveComponent,
  setComponentValue,
  type World,
} from "./world"

import {getResource} from "./world_api"

export type RegistryDomainCheckpoint = {
  readonly domainId: number
  readonly entityId: number
  readonly opSeq: number
  readonly entityCount: number
  readonly dense: number[]
  readonly sparse: Map<number, number>
  readonly freeIds: number[]
}

export type Checkpoint = {
  readonly tick: number
  readonly tickSpawnCount: number
  readonly componentData: Map<number, unknown[]>
  readonly componentVersions: Map<number, Uint32Array>
  readonly entityArchetypes: Int32Array
  readonly registryDomains: RegistryDomainCheckpoint[]
  readonly entityToIndex: Map<number, number>
  readonly indexToEntity: number[]
  readonly freeIndices: number[]
  readonly nextIndex: number
  readonly nodeVecs: Map<number, Vec>
  readonly relations: {
    readonly relToVirtual: Map<number, Map<number, number>>
    readonly virtualToRel: Map<number, RelationPair>
    readonly objectToSubjects: Map<number, Set<RelationSubject>>
    readonly nextVirtualId: number
  }
}

export type UndoOp =
  | {type: "undo-spawn"; entity: Entity}
  | {type: "undo-despawn"; entity: Entity; components: SpawnComponent[]}
  | {
      type: "undo-add"
      entity: Entity
      componentId: number
      rel?: RelationPair
    }
  | {
      type: "undo-remove"
      entity: Entity
      componentId: number
      data: unknown
      rel?: RelationPair
    }

export type UndoEntry = {
  readonly tick: number
  readonly ops: UndoOp[]
}

export const HistoryBuffer = defineComponent<{
  checkpoints: Checkpoint[]
  undoLog: UndoEntry[]
  maxSize: number
  checkpointInterval: number
}>("glom/HistoryBuffer", {
  bytesPerElement: 0,
  encode: () => {},
  decode: () => ({
    checkpoints: [],
    undoLog: [],
    maxSize: 64,
    checkpointInterval: 1,
  }),
})

export type HistoryBuffer = {
  checkpoints: Checkpoint[]
  undoLog: UndoEntry[]
  maxSize: number
  checkpointInterval: number
}

export function makeHistoryBuffer(
  maxSize = 64,
  checkpointInterval = 1,
): HistoryBuffer {
  return {
    checkpoints: [],
    undoLog: [],
    maxSize,
    checkpointInterval,
  }
}

// Shared writer/reader for serde round-trip deep copies (avoids structuredClone).
const _serdeWriter = new ByteWriter(4096)
const _serdeReader = new ByteReader(new Uint8Array(0))

export function captureCheckpoint(world: World): Checkpoint {
  const componentData = new Map<number, unknown[]>()
  const nextIndex = world.index.nextIndex

  for (const [id, store] of world.components.storage) {
    if (store.length === 0) continue
    const slice = new Array(nextIndex)
    const serde = getComponentSerde(world, id)
    for (let i = 0; i < nextIndex; i++) {
      const v = store[i]
      if (v !== undefined && v !== null && typeof v === "object") {
        if (serde !== undefined) {
          // Serde round-trip: faster than structuredClone for known types
          _serdeWriter.reset()
          serde.encode(v, _serdeWriter)
          _serdeReader.reset(_serdeWriter.getBytes())
          slice[i] = serde.decode(_serdeReader, undefined as unknown)
        } else {
          try {
            slice[i] = structuredClone(v)
          } catch {
            slice[i] = v
          }
        }
      } else {
        slice[i] = v
      }
    }
    componentData.set(id, slice)
  }

  const componentVersions = new Map<number, Uint32Array>()
  for (const [id, versions] of world.components.versions) {
    if (versions.length === 0) continue
    const len = Math.min(versions.length, nextIndex)
    const clone = new Uint32Array(len)
    clone.set(versions.subarray(0, len))
    componentVersions.set(id, clone)
  }

  const entityArchetypes = new Int32Array(nextIndex)
  const nodeVecs = new Map<number, Vec>()

  sparseMapForEach(world.entityGraph.byEntity, (entity, node) => {
    const index = sparseMapGet(world.index.entityToIndex, entity)
    if (index !== undefined) {
      entityArchetypes[index] = node.id
      if (!nodeVecs.has(node.id)) {
        nodeVecs.set(node.id, node.vec)
      }
    }
  })

  const registryDomains: RegistryDomainCheckpoint[] = []
  for (let i = 0; i < world.registry.domains.length; i++) {
    const domain = world.registry.domains[i]
    if (domain !== undefined) {
      registryDomains[i] = {
        domainId: domain.domainId,
        entityId: domain.entityId,
        opSeq: domain.opSeq,
        entityCount: domain.entityCount,
        dense: [...domain.dense],
        sparse: new Map(domain.sparse),
        freeIds: [...domain.freeIds],
      }
    }
  }

  const entityToIndex = new Map<number, number>()
  sparseMapForEach(world.index.entityToIndex, (entity, index) => {
    entityToIndex.set(entity, index)
  })

  const relToVirtual = new Map<number, Map<number, number>>()
  for (const [relId, objMap] of world.relations.relToVirtual) {
    relToVirtual.set(relId, new Map(objMap))
  }

  const virtualToRel = new Map<number, RelationPair>()
  for (const [vid, relInfo] of world.relations.virtualToRel) {
    virtualToRel.set(vid, {...relInfo} as RelationPair)
  }

  const objectToSubjects = new Map<number, Set<RelationSubject>>()
  for (const [obj, subjects] of world.relations.objectToSubjects) {
    const clonedSubjects = new Set<RelationSubject>()
    for (const item of subjects) {
      clonedSubjects.add({...item} as RelationSubject)
    }
    objectToSubjects.set(obj, clonedSubjects)
  }

  return {
    tick: world.tick,
    tickSpawnCount: world.tickSpawnCount,
    componentData,
    componentVersions,
    entityArchetypes,
    nodeVecs,
    registryDomains,
    entityToIndex,
    indexToEntity: world.index.indexToEntity.slice(0, nextIndex),
    freeIndices: [...world.index.freeIndices],
    nextIndex: world.index.nextIndex,
    relations: {
      relToVirtual,
      virtualToRel,
      objectToSubjects,
      nextVirtualId: world.componentRegistry.getNextVirtualId(),
    },
  }
}

export function restoreCheckpoint(world: World, checkpoint: Checkpoint) {
  world.tick = checkpoint.tick
  world.tickSpawnCount = checkpoint.tickSpawnCount

  for (let i = 0; i < checkpoint.registryDomains.length; i++) {
    const sDomain = checkpoint.registryDomains[i]
    if (sDomain === undefined) continue

    let domain = world.registry.domains[i]
    if (domain === undefined) {
      domain = {
        domainId: sDomain.domainId,
        entityId: sDomain.entityId,
        opSeq: sDomain.opSeq,
        entityCount: sDomain.entityCount,
        dense: [...sDomain.dense],
        sparse: new Map(sDomain.sparse),
        freeIds: sDomain.freeIds !== undefined ? [...sDomain.freeIds] : [],
      }
      world.registry.domains[i] = domain
      continue
    }

    domain.entityId = sDomain.entityId
    domain.opSeq = sDomain.opSeq
    domain.entityCount = sDomain.entityCount
    domain.dense.length = 0
    domain.dense.push(...sDomain.dense)
    domain.sparse.clear()
    for (const [k, v] of sDomain.sparse) {
      domain.sparse.set(k, v)
    }
    domain.freeIds.length = 0
    if (sDomain.freeIds !== undefined) {
      domain.freeIds.push(...sDomain.freeIds)
    }
  }

  sparseMapClear(world.index.entityToIndex)
  for (const [entity, index] of checkpoint.entityToIndex) {
    sparseMapSet(world.index.entityToIndex, entity, index)
  }
  world.index.indexToEntity.length = 0
  world.index.indexToEntity.push(...checkpoint.indexToEntity)
  world.index.freeIndices.length = 0
  world.index.freeIndices.push(...checkpoint.freeIndices)
  world.index.nextIndex = checkpoint.nextIndex

  for (const [id, currentStore] of world.components.storage) {
    if (!checkpoint.componentData.has(id)) {
      // Preserve resource values (index 0) — they must survive rollbacks
      const saved = currentStore[0]
      currentStore.length = 0
      if (saved !== undefined) {
        currentStore[0] = saved
      }
    }
  }

  for (const [id, store] of checkpoint.componentData) {
    let currentStore = world.components.storage.get(id)
    if (currentStore === undefined) {
      currentStore = []
      world.components.storage.set(id, currentStore)
    }
    // Preserve resource values (index 0) — they must survive rollbacks.
    // Resources like HistoryBuffer, CommandBuffer, InputBuffer, etc.
    // are stored at index 0 (RESOURCE_ENTITY) and contain temporal data
    // that should not be overwritten during checkpoint restoration.
    const savedResource = currentStore[0]
    const serde = getComponentSerde(world, id)
    currentStore.length = store.length
    for (let i = 0; i < store.length; i++) {
      if (i === 0) {
        // Keep the live resource value instead of restoring from checkpoint
        currentStore[0] = savedResource
        continue
      }
      const v = store[i]
      if (v !== undefined && v !== null && typeof v === "object") {
        if (serde !== undefined) {
          // Serde round-trip: faster than structuredClone for known types
          _serdeWriter.reset()
          serde.encode(v, _serdeWriter)
          _serdeReader.reset(_serdeWriter.getBytes())
          currentStore[i] = serde.decode(_serdeReader, undefined as unknown)
        } else {
          try {
            currentStore[i] = structuredClone(v)
          } catch {
            currentStore[i] = v
          }
        }
      } else {
        currentStore[i] = v
      }
    }
  }

  for (const [id, currentVersions] of world.components.versions) {
    if (!checkpoint.componentVersions.has(id)) {
      currentVersions.fill(0)
    }
  }

  for (const [id, versions] of checkpoint.componentVersions) {
    const currentVersions = world.components.versions.get(id)
    if (
      currentVersions === undefined ||
      currentVersions.length < versions.length
    ) {
      world.components.versions.set(id, new Uint32Array(versions))
    } else {
      currentVersions.set(versions)
      if (currentVersions.length > versions.length) {
        currentVersions.fill(0, versions.length)
      }
    }
  }

  world.relations.relToVirtual.clear()
  for (const [relId, objMap] of checkpoint.relations.relToVirtual) {
    world.relations.relToVirtual.set(relId, new Map(objMap))
  }

  world.relations.virtualToRel.clear()
  for (const [vid, relInfo] of checkpoint.relations.virtualToRel) {
    world.relations.virtualToRel.set(vid, {...relInfo})
  }

  world.relations.objectToSubjects.clear()
  for (const [obj, subjects] of checkpoint.relations.objectToSubjects) {
    const restoredSubjects = new Set<RelationSubject>()
    for (const item of subjects) {
      restoredSubjects.add({...item} as RelationSubject)
    }
    world.relations.objectToSubjects.set(obj, restoredSubjects)
  }
  world.componentRegistry.setNextVirtualId(checkpoint.relations.nextVirtualId)

  for (const node of world.entityGraph.byHash.values()) {
    if (sparseSetSize(node.entities) > 0) {
      sparseSetClear(node.entities)
    }
    node.indices.length = 0
    node.relMaps.length = 0
  }

  sparseMapClear(world.graphChanges)
  world.pendingDeletions.clear()
  world.pendingRemovals.clear()

  const nodesById: Map<number, EntityGraphNode> = new Map()
  for (const node of world.entityGraph.byHash.values()) {
    nodesById.set(node.id, node)
  }

  sparseMapClear(world.entityGraph.byEntity)
  for (let i = 0; i < checkpoint.entityArchetypes.length; i++) {
    const nodeId = checkpoint.entityArchetypes[i] as number
    if (nodeId === 0) continue

    const entity = checkpoint.indexToEntity[i] as Entity | undefined
    if (entity === undefined || (entity as unknown as number) === 0) continue

    let node = nodesById.get(nodeId)
    if (node === undefined) {
      // The node was pruned from byHash since the checkpoint was captured.
      // Recreate it from the stored vec so the entity is not silently lost.
      const vec = checkpoint.nodeVecs?.get(nodeId)
      if (vec !== undefined) {
        node = entityGraphFindOrCreateNode(world.entityGraph, vec)
        nodesById.set(nodeId, node)
      }
    }
    if (node !== undefined) {
      sparseMapSet(
        world.entityGraph.byEntity,
        entity as unknown as number,
        node,
      )
      sparseSetAdd(node.entities, entity)
      node.indices.push(i)
    }
  }

  for (const [obj, subjects] of world.relations.objectToSubjects) {
    const node = getEntityNode(world, obj as Entity)
    if (node !== undefined) {
      for (const {subject, relationId} of subjects) {
        entityGraphNodeAddRelation(
          node,
          relationId,
          subject as Entity,
          obj as Entity,
        )
      }
    }
  }
}

export function pushCheckpoint(world: World, history: HistoryBuffer) {
  const checkpoint = captureCheckpoint(world)
  history.checkpoints.push(checkpoint)
  if (history.checkpoints.length > history.maxSize) {
    history.checkpoints.shift()
  }
}

// --- Undo log application ---

function undoSpawn(world: World, entity: Entity) {
  const node = getEntityNode(world, entity)
  if (node !== undefined) {
    const elements = node.vec.elements
    for (let i = 0; i < elements.length; i++) {
      deleteComponentValue(world, entity, elements[i] as ComponentLike)
    }
    entityGraphNodeRemoveEntity(node, entity)
    sparseMapDelete(world.entityGraph.byEntity, entity as number)
  }

  const idx = sparseMapGet(world.index.entityToIndex, entity)
  if (idx !== undefined) {
    world.index.freeIndices.push(idx)
    sparseMapDelete(world.index.entityToIndex, entity)
  }

  removeEntity(world.registry, entity)
}

function undoDespawn(
  world: World,
  entity: Entity,
  components: SpawnComponent[],
) {
  const domainId = getDomainId(entity)
  const domain = getDomain(world.registry, domainId)
  addDomainEntity(domain, entity)

  const resolved: ComponentLike[] = []
  for (let i = 0; i < components.length; i++) {
    const {id, data, rel} = components[i]!
    const component = resolveComponent(world, id)
    if (component === undefined) {
      continue
    }
    if (data !== undefined) {
      setComponentValue(world, entity, component as Component<unknown>, data)
    }
    resolved.push(component)
    if (rel !== undefined) {
      getOrCreateVirtualMap(world, rel.relationId).set(rel.object, id)
      setRelationPair(world, id, rel)
      registerIncomingRelation(
        world,
        entity,
        rel.relationId,
        rel.object as Entity,
      )
    }
  }

  const vec = makeVec(resolved, world.componentRegistry)
  const node = entityGraphFindOrCreateNode(world.entityGraph, vec)
  const index = getOrCreateIndex(world, entity as number)
  entityGraphNodeAddEntity(node, entity, index)
  sparseMapSet(world.entityGraph.byEntity, entity as number, node)
}

function undoAddComponent(world: World, entity: Entity, componentId: number) {
  const comp = resolveComponent(world, componentId)
  if (comp === undefined) return

  const node = getEntityNode(world, entity)
  if (node === undefined) return

  deleteComponentValue(world, entity, comp)

  const nextVec = vecDifference(
    node.vec,
    makeVec([comp], world.componentRegistry),
    world.componentRegistry,
  )
  const nextNode = entityGraphFindOrCreateNode(world.entityGraph, nextVec)
  const index = sparseMapGet(world.index.entityToIndex, entity)
  if (index !== undefined) {
    entityGraphNodeRemoveEntity(node, entity)
    entityGraphNodeAddEntity(nextNode, entity, index)
    sparseMapSet(world.entityGraph.byEntity, entity as number, nextNode)
  }
}

function undoRemoveComponent(
  world: World,
  entity: Entity,
  componentId: number,
  data: unknown,
  rel?: RelationPair,
) {
  const component = resolveComponent(world, componentId)
  if (component === undefined) {
    return
  }

  const node = getEntityNode(world, entity)
  if (node === undefined) {
    return
  }

  if (data !== undefined) {
    setComponentValue(world, entity, component, data)
  }

  if (rel !== undefined) {
    getOrCreateVirtualMap(world, rel.relationId).set(rel.object, componentId)
    setRelationPair(world, componentId, rel)
    registerIncomingRelation(
      world,
      entity,
      rel.relationId,
      rel.object as Entity,
    )
  }

  const nextVec = vecSum(
    node.vec,
    makeVec([component], world.componentRegistry),
    world.componentRegistry,
  )
  const nextNode = entityGraphFindOrCreateNode(world.entityGraph, nextVec)
  const index = sparseMapGet(world.index.entityToIndex, entity)
  if (index !== undefined) {
    entityGraphNodeRemoveEntity(node, entity)
    entityGraphNodeAddEntity(nextNode, entity, index)
    sparseMapSet(world.entityGraph.byEntity, entity as number, nextNode)
  }
}

export function applyUndoLog(
  world: World,
  undoLog: UndoEntry[],
  targetTick: number,
) {
  for (let i = undoLog.length - 1; i >= 0; i--) {
    const entry = undoLog[i]!
    if (entry.tick < targetTick) {
      break
    }
    for (let j = entry.ops.length - 1; j >= 0; j--) {
      const op = entry.ops[j]!
      switch (op.type) {
        case "undo-spawn":
          undoSpawn(world, op.entity)
          break
        case "undo-despawn":
          undoDespawn(world, op.entity, op.components)
          break
        case "undo-add":
          undoAddComponent(world, op.entity, op.componentId)
          break
        case "undo-remove":
          undoRemoveComponent(world, op.entity, op.componentId, op.data, op.rel)
          break
      }
    }
  }

  sparseMapClear(world.graphChanges)
  world.pendingDeletions.clear()
  world.pendingRemovals.clear()
}

export function rollbackToTick(
  world: World,
  history: HistoryBuffer | Component<HistoryBuffer>,
  tick: number,
): boolean {
  const buffer =
    "checkpoints" in history ? history : getResource(world, history)
  if (buffer === undefined) {
    return false
  }

  let bestCheckpoint: Checkpoint | undefined
  let bestIdx = -1
  for (let i = buffer.checkpoints.length - 1; i >= 0; i--) {
    const checkpoint = buffer.checkpoints[i]!
    if (checkpoint.tick <= tick) {
      bestCheckpoint = checkpoint
      bestIdx = i
      break
    }
  }

  if (bestCheckpoint === undefined) {
    return false
  }

  restoreCheckpoint(world, bestCheckpoint)

  // Truncate checkpoints after this one
  buffer.checkpoints.length = bestIdx + 1

  // Trim undo log entries at or after the checkpoint tick
  while (
    buffer.undoLog.length > 0 &&
    buffer.undoLog[buffer.undoLog.length - 1]!.tick >= bestCheckpoint.tick
  ) {
    buffer.undoLog.pop()
  }

  return true
}
