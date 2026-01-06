import {defineComponent} from "./component"
import type {Entity} from "./entity"
import {
  type EntityGraphNode,
  entityGraphNodeAddRelation,
} from "./entity_graph"
import type {RelationPair, RelationSubject} from "./relation_registry"
import {
  sparseMapClear,
  sparseMapForEach,
  sparseMapGet,
  sparseMapSet,
} from "./sparse_map"
import {sparseSetAdd, sparseSetClear, sparseSetSize} from "./sparse_set"
import type {World} from "./world"

import {addResource, getResource} from "./world_api"

export type RegistryDomainSnapshot = {
  readonly domainId: number
  readonly entityId: number
  readonly opSeq: number
  readonly entityCount: number
  readonly dense: number[]
  readonly sparse: Map<number, number>
}

export type Snapshot = {
  readonly tick: number
  readonly tickSpawnCount: number
  readonly componentData: Map<number, unknown[]>
  readonly componentVersions: Map<number, Uint32Array>
  readonly entityArchetypes: Int32Array
  readonly registryDomains: RegistryDomainSnapshot[]
  readonly entityToIndex: Map<number, number>
  readonly indexToEntity: number[]
  readonly freeIndices: number[]
  readonly nextIndex: number
  readonly relations: {
    readonly relToVirtual: Map<number, Map<number, number>>
    readonly virtualToRel: Map<number, RelationPair>
    readonly objectToSubjects: Map<number, Set<RelationSubject>>
    readonly nextVirtualId: number
  }
}

export const HistoryBuffer = defineComponent<{
  snapshots: Snapshot[]
  maxSize: number
}>(
  {
    bytesPerElement: 0,
    encode: () => {},
    decode: () => ({snapshots: [], maxSize: 64}),
  },
  10, // Assign a unique ID
)

export type HistoryBuffer = {
  snapshots: Snapshot[]
  maxSize: number
}

export function makeHistoryBuffer(maxSize = 64): HistoryBuffer {
  return {
    snapshots: [],
    maxSize,
  }
}

export function captureSnapshot(world: World): Snapshot {
  const componentData = new Map<number, unknown[]>()
  const nextIdx = world.index.nextIndex

  for (const [id, store] of world.components.storage) {
    if (store.length === 0) continue
    componentData.set(id, store.slice(0, nextIdx))
  }

  const componentVersions = new Map<number, Uint32Array>()
  for (const [id, versions] of world.components.versions) {
    if (versions.length === 0) continue
    const len = Math.min(versions.length, nextIdx)
    const clone = new Uint32Array(len)
    clone.set(versions.subarray(0, len))
    componentVersions.set(id, clone)
  }

  const entityArchetypes = new Int32Array(nextIdx)

  sparseMapForEach(world.entityGraph.byEntity, (entity, node) => {
    const idx = sparseMapGet(world.index.entityToIndex, entity)
    if (idx !== undefined) {
      entityArchetypes[idx] = node.id
    }
  })

  const registryDomains: RegistryDomainSnapshot[] = []
  for (let i = 0; i < world.registry.domains.length; i++) {
    const domain = world.registry.domains[i]
    if (domain) {
      registryDomains[i] = {
        domainId: domain.domainId,
        entityId: domain.entityId,
        opSeq: domain.opSeq,
        entityCount: domain.entityCount,
        dense: [...domain.dense],
        sparse: new Map(domain.sparse),
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
    registryDomains,
    entityToIndex,
    indexToEntity: world.index.indexToEntity.slice(0, nextIdx),
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

export function rollbackToSnapshot(world: World, snapshot: Snapshot) {
  world.tick = snapshot.tick
  world.tickSpawnCount = snapshot.tickSpawnCount

  for (let i = 0; i < snapshot.registryDomains.length; i++) {
    const sDomain = snapshot.registryDomains[i]
    if (!sDomain) continue

    let domain = world.registry.domains[i]
    if (!domain) {
      domain = {
        domainId: sDomain.domainId,
        entityId: sDomain.entityId,
        opSeq: sDomain.opSeq,
        entityCount: sDomain.entityCount,
        dense: [...sDomain.dense],
        sparse: new Map(sDomain.sparse),
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
  }

  sparseMapClear(world.index.entityToIndex)
  for (const [entity, index] of snapshot.entityToIndex) {
    sparseMapSet(world.index.entityToIndex, entity, index)
  }
  world.index.indexToEntity.length = 0
  world.index.indexToEntity.push(...snapshot.indexToEntity)
  world.index.freeIndices.length = 0
  world.index.freeIndices.push(...snapshot.freeIndices)
  world.index.nextIndex = snapshot.nextIndex

  for (const [id, currentStore] of world.components.storage) {
    if (!snapshot.componentData.has(id)) {
      currentStore.length = 0
    }
  }

  for (const [id, store] of snapshot.componentData) {
    let currentStore = world.components.storage.get(id)
    if (!currentStore) {
      currentStore = []
      world.components.storage.set(id, currentStore)
    }
    currentStore.length = store.length
    for (let i = 0; i < store.length; i++) {
      currentStore[i] = store[i]
    }
  }

  for (const [id, currentVersions] of world.components.versions) {
    if (!snapshot.componentVersions.has(id)) {
      currentVersions.fill(0)
    }
  }

  for (const [id, versions] of snapshot.componentVersions) {
    const currentVersions = world.components.versions.get(id)
    if (!currentVersions || currentVersions.length < versions.length) {
      world.components.versions.set(id, new Uint32Array(versions))
    } else {
      currentVersions.set(versions)
      if (currentVersions.length > versions.length) {
        currentVersions.fill(0, versions.length)
      }
    }
  }

  world.relations.relToVirtual.clear()
  for (const [relId, objMap] of snapshot.relations.relToVirtual) {
    world.relations.relToVirtual.set(relId, new Map(objMap))
  }

  world.relations.virtualToRel.clear()
  for (const [vid, relInfo] of snapshot.relations.virtualToRel) {
    world.relations.virtualToRel.set(vid, {...relInfo})
  }

  world.relations.objectToSubjects.clear()
  for (const [obj, subjects] of snapshot.relations.objectToSubjects) {
    const restoredSubjects = new Set<RelationSubject>()
    for (const item of subjects) {
      restoredSubjects.add({...item} as RelationSubject)
    }
    world.relations.objectToSubjects.set(obj, restoredSubjects)
  }
  world.componentRegistry.setNextVirtualId(
    snapshot.relations.nextVirtualId,
  )

  for (const node of world.entityGraph.byHash.values()) {
    if (sparseSetSize(node.entities) > 0) {
      sparseSetClear(node.entities)
    }
    node.indices.length = 0
    node.relMaps.length = 0
  }

  sparseMapClear(world.graphChanges)
  world.pendingDeletions.clear()
  world.pendingComponentRemovals.clear()

  const nodesById: Map<number, EntityGraphNode> = new Map()
  for (const node of world.entityGraph.byHash.values()) {
    nodesById.set(node.id, node)
  }

  sparseMapClear(world.entityGraph.byEntity)
  for (let i = 0; i < snapshot.entityArchetypes.length; i++) {
    const nodeId = snapshot.entityArchetypes[i] as number
    if (nodeId === 0) continue

    const entity = snapshot.indexToEntity[i] as Entity | undefined
    if (entity === undefined || (entity as unknown as number) === 0) continue

    const node = nodesById.get(nodeId)
    if (node) {
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
    const node = sparseMapGet(world.entityGraph.byEntity, obj as number)
    if (node) {
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

export function pushSnapshot(world: World, history: HistoryBuffer) {
  const snapshot = captureSnapshot(world)
  history.snapshots.push(snapshot)
  if (history.snapshots.length > history.maxSize) {
    history.snapshots.shift()
  }
}

export function rollbackToTick(
  world: World,
  history: HistoryBuffer | Component<HistoryBuffer>,
  tick: number,
): boolean {
  const buffer =
    "snapshots" in history ? history : getResource(world, history)
  if (!buffer) return false

  const snapshot = buffer.snapshots.find((s) => s.tick === tick)
  if (!snapshot) return false
  rollbackToSnapshot(world, snapshot)

  const index = buffer.snapshots.indexOf(snapshot)
  buffer.snapshots.length = index + 1
  return true
}
