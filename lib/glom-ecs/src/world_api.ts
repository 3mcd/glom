import {
  addClocksyncSample,
  getAverageRtt,
  getConsensusOffset,
} from "./clocksync"
import type {Component, ComponentInstance, ComponentLike} from "./component"
import {type Entity, getDomainId} from "./entity"
import {
  createEntityBatchKey,
  type EntityGraphBatch,
  type EntityGraphNode,
  emitDespawnedEntities,
  emitMovedEntities,
  emitSpawnedEntities,
  entityGraphBatchAdd,
  entityGraphFindOrCreateNode,
  entityGraphGetEntityNode,
  entityGraphNodeAddRelation,
  entityGraphNodePrune,
  entityGraphNodeRemoveEntity,
  entityGraphNodeRemoveRelation,
  entityGraphSetEntityNode,
  PruneStrategy,
  poolGetBatch,
  poolReturnBatch,
} from "./entity_graph"
import {
  allocEntity,
  getDomain,
  nextOpSeq,
  removeEntity,
} from "./entity_registry"
import {addDomainEntity} from "./entity_registry_domain"
import {HistoryBuffer, pushCheckpoint, pushSnapshot} from "./history"
import type {AddOp, ReplicationOp, SpawnComponent} from "./net_types"
import {isRelationship} from "./relation"
import {
  getOrCreateVirtualId,
  getVirtualId,
  registerIncomingRelation,
  unregisterIncomingRelation,
} from "./relation_registry"
import {
  makeCausalKey,
  poolGetOp,
  poolReturnOp,
  TRANSIENT_DOMAIN,
  COMMAND_DOMAIN,
} from "./replication"
import {
  Replicated,
  ReplicationConfig,
  ReplicationStream,
} from "./replication_config"
import {
  sparseMapClear,
  sparseMapDelete,
  sparseMapForEach,
  sparseMapGet,
  sparseMapSet,
} from "./sparse_map"
import {sparseSetSize} from "./sparse_set"
import {makeVec, vecDifference, vecSum} from "./vec"
import {
  addResource,
  deleteComponentValue,
  getComponentValue,
  getComponentValueById,
  getOrCreateIndex,
  getResource,
  makeVersion,
  setComponentValue,
  type World,
} from "./world"

export {
  addResource,
  deleteComponentValue,
  getComponentValue,
  getResource,
  setComponentValue,
  type World,
  getOrCreateIndex,
}

function recordGraphMove(
  world: World,
  entity: Entity,
  prevNode: EntityGraphNode | undefined,
  nextNode: EntityGraphNode | undefined,
) {
  if (prevNode) {
    world.pendingNodePruning.add(prevNode)
  }
  let move = sparseMapGet(world.graphChanges, entity as number)
  if (!move) {
    move = {entity, from: prevNode, to: nextNode}
    sparseMapSet(world.graphChanges, entity as number, move)
  } else {
    move.to = nextNode
  }
}

export function setEntityNode(
  world: World,
  entity: Entity,
  nextNode: EntityGraphNode,
): EntityGraphNode | undefined {
  const index = getOrCreateIndex(world, entity as number)
  const prevNode = entityGraphSetEntityNode(
    world.entityGraph,
    entity,
    nextNode,
    index,
  )
  if (prevNode === nextNode) return prevNode

  const incoming = world.relations.objectToSubjects.get(entity)
  if (incoming) {
    for (const {subject, relationId} of incoming) {
      if (prevNode) {
        entityGraphNodeRemoveRelation(
          prevNode,
          relationId,
          subject as Entity,
          entity,
        )
      }
      entityGraphNodeAddRelation(
        nextNode,
        relationId,
        subject as Entity,
        entity,
      )
    }
  }

  return prevNode
}

export function spawn(
  world: World,
  ...components: (ComponentInstance<unknown> | ComponentLike)[]
): Entity {
  return spawnInDomain(world, components)
}

export function spawnInDomain(
  world: World,
  components: (ComponentInstance<unknown> | ComponentLike)[],
  domainId = world.registry.domainId,
  intentTick = world.tick,
): Entity {
  let isReplicated = false
  for (let i = 0; i < components.length; i++) {
    const c = components[i]
    if (c && typeof c === "object" && "component" in c) {
      if (
        world.componentRegistry.getId(
          (c as ComponentInstance<unknown>).component,
        ) === Replicated.id
      ) {
        isReplicated = true
        break
      }
    } else if (c && !isRelationship(c)) {
      if (world.componentRegistry.getId(c as ComponentLike) === Replicated.id) {
        isReplicated = true
        break
      }
    }
  }

  const causalTick = intentTick
  const causalIndex = isReplicated ? world.tickSpawnCount++ : 0x7fff
  const causalKey = makeCausalKey(causalTick, causalIndex)

  let entity: Entity
  const existing = world.transientRegistry.get(causalKey)
  if (existing) {
    entity = existing.entity
    addDomainEntity(getDomain(world.registry, getDomainId(entity)), entity)
  } else {
    const isPrediction = !!getResource(world, HistoryBuffer)
    const actualDomainId = isPrediction ? TRANSIENT_DOMAIN : domainId
    entity = allocEntity(world.registry, actualDomainId)
  }

  const resolvedComponents: ComponentLike[] = []

  for (let i = 0; i < components.length; i++) {
    const item = components[i]
    if (item && typeof item === "object" && "component" in item) {
      const inst = item as ComponentInstance<unknown>
      resolvedComponents.push(inst.component)
      setComponentValue(
        world,
        entity,
        inst.component as Component<unknown>,
        inst.value,
      )
    } else if (item) {
      if (isRelationship(item)) {
        const vid = getOrCreateVirtualId(world, item.relation, item.object)
        resolvedComponents.push(
          world.componentRegistry.getVirtualComponent(vid),
        )
        resolvedComponents.push(item.relation)
        registerIncomingRelation(
          world,
          entity,
          world.componentRegistry.getId(item.relation),
          item.object,
        )
      } else {
        resolvedComponents.push(item)
      }
    }
  }

  if (getDomainId(entity) === TRANSIENT_DOMAIN && domainId !== COMMAND_DOMAIN) {
    world.transientRegistry.set(causalKey, {
      entity,
      tick: world.tick,
    })
  }

  if (domainId === world.registry.domainId) {
    let replicatedCheck = false
    for (let i = 0; i < resolvedComponents.length; i++) {
      if (
        world.componentRegistry.getId(
          resolvedComponents[i] as ComponentLike,
        ) === Replicated.id
      ) {
        replicatedCheck = true
        break
      }
    }
    if (replicatedCheck) {
      const op = poolGetOp("spawn")
      op.entity = entity
      op.causalKey = causalKey
      op.components = []
      for (let i = 0; i < resolvedComponents.length; i++) {
        const c = resolvedComponents[i] as ComponentLike
        const id = world.componentRegistry.getId(c)
        op.components.push({
          id,
          data: getComponentValue(world, entity, c),
          rel: world.relations.virtualToRel.get(id),
        })
      }
      world.pendingOps.push(op)
    }
  }

  const vec = makeVec(resolvedComponents, world.componentRegistry)
  const node = entityGraphFindOrCreateNode(world.entityGraph, vec)
  const prevNode = setEntityNode(world, entity, node)

  recordGraphMove(world, entity, prevNode, node)

  if (getDomainId(entity) !== COMMAND_DOMAIN) {
    world.currentUndoEntries.push({type: "undo-spawn", entity})
  }

  return entity
}

export function despawn(world: World, entity: Entity): void {
  const node = entityGraphGetEntityNode(world.entityGraph, entity)
  if (!node) {
    return
  }

  // Record undo-despawn before any cleanup
  if (getDomainId(entity) !== COMMAND_DOMAIN) {
    const undoComponents: SpawnComponent[] = []
    const els = node.vec.elements
    for (let k = 0; k < els.length; k++) {
      const comp = els[k] as ComponentLike
      const compId = world.componentRegistry.getId(comp)
      undoComponents.push({
        id: compId,
        data: getComponentValue(world, entity, comp),
        rel: world.relations.virtualToRel.get(compId),
      })
    }
    world.currentUndoEntries.push({
      type: "undo-despawn",
      entity,
      components: undoComponents,
    })
  }

  const domainId = world.registry.domainId
  if (getDomainId(entity) === domainId) {
    let isReplicated = false
    const elements = node.vec.elements
    for (let i = 0; i < elements.length; i++) {
      if (
        world.componentRegistry.getId(elements[i] as ComponentLike) ===
        Replicated.id
      ) {
        isReplicated = true
        break
      }
    }
    if (isReplicated) {
      const op = poolGetOp("despawn")
      op.entity = entity
      world.pendingOps.push(op)
    }
  }

  const incoming = world.relations.objectToSubjects.get(entity)
  if (incoming) {
    const toRemove = Array.from(incoming)
    for (let i = 0; i < toRemove.length; i++) {
      const {subject, relationId} = toRemove[i] as {
        subject: Entity
        relationId: number
      }
      removeRelation(world, subject as Entity, relationId, entity)
    }
  }

  const elements = node.vec.elements
  for (let i = 0; i < elements.length; i++) {
    const comp = elements[i] as ComponentLike
    const compId = world.componentRegistry.getId(comp)
    const rel = world.relations.virtualToRel.get(compId)
    if (rel) {
      unregisterIncomingRelation(
        world,
        entity,
        rel.relationId,
        rel.object as Entity,
      )
    }
  }

  world.pendingDeletions.add(entity)

  const prevNode = sparseMapGet(world.entityGraph.byEntity, entity as number)
  if (prevNode) {
    const incoming = world.relations.objectToSubjects.get(entity)
    if (incoming) {
      for (const {subject, relationId} of incoming) {
        entityGraphNodeRemoveRelation(
          prevNode,
          relationId,
          subject as Entity,
          entity,
        )
      }
    }
    entityGraphNodeRemoveEntity(prevNode, entity)
    sparseMapDelete(world.entityGraph.byEntity, entity as number)
    recordGraphMove(world, entity, prevNode, undefined)
  }
}

function removeRelation(
  world: World,
  entity: Entity,
  relationId: number,
  object: Entity,
): void {
  const node = entityGraphGetEntityNode(world.entityGraph, entity)
  if (!node) return

  const virtualId = getVirtualId(world.relations, relationId, object)
  if (virtualId === undefined) return

  const vidComp = world.componentRegistry.getVirtualComponent(virtualId)
  let nextVec = vecDifference(
    node.vec,
    makeVec([vidComp as Component<unknown>], world.componentRegistry),
    world.componentRegistry,
  )

  let hasOtherRelations = false
  const elements = nextVec.elements
  for (let i = 0; i < elements.length; i++) {
    const comp = elements[i] as ComponentLike
    const rel = world.relations.virtualToRel.get(
      world.componentRegistry.getId(comp),
    )
    if (rel && rel.relationId === relationId) {
      hasOtherRelations = true
      break
    }
  }

  if (!hasOtherRelations) {
    const relTag = world.componentRegistry.getComponent(relationId)
    if (relTag) {
      nextVec = vecDifference(
        nextVec,
        makeVec([relTag], world.componentRegistry),
        world.componentRegistry,
      )
    }
  }

  const nextNode = entityGraphFindOrCreateNode(world.entityGraph, nextVec)
  const prevNode = setEntityNode(world, entity, nextNode)
  recordGraphMove(world, entity, prevNode, nextNode)
  unregisterIncomingRelation(world, entity, relationId, object)
}

export function addComponent(
  world: World,
  entity: Entity,
  item: ComponentInstance<unknown> | ComponentLike,
): void {
  const node = entityGraphGetEntityNode(world.entityGraph, entity)
  if (!node) return

  const toAdd: ComponentLike[] = []
  if (item && typeof item === "object" && "component" in item) {
    const inst = item as ComponentInstance<unknown>
    toAdd.push(inst.component)
    setComponentValue(
      world,
      entity,
      inst.component as Component<unknown>,
      inst.value,
    )
  } else if (item) {
    if (isRelationship(item)) {
      const vid = getOrCreateVirtualId(world, item.relation, item.object)
      toAdd.push(world.componentRegistry.getVirtualComponent(vid))
      toAdd.push(item.relation)
      registerIncomingRelation(
        world,
        entity,
        world.componentRegistry.getId(item.relation),
        item.object,
      )
    } else {
      toAdd.push(item)
    }
  }

  if (toAdd.length > 0) {
    // Record undo-add entries for each added component
    if (getDomainId(entity) !== COMMAND_DOMAIN) {
      for (let i = 0; i < toAdd.length; i++) {
        const c = toAdd[i] as ComponentLike
        const cid = world.componentRegistry.getId(c)
        world.currentUndoEntries.push({
          type: "undo-add",
          entity,
          componentId: cid,
          rel: world.relations.virtualToRel.get(cid),
        })
      }
    }

    if (getDomainId(entity) === world.registry.domainId) {
      let alreadyReplicated = false
      const elements = node.vec.elements
      for (let i = 0; i < elements.length; i++) {
        if (
          world.componentRegistry.getId(elements[i] as ComponentLike) ===
          Replicated.id
        ) {
          alreadyReplicated = true
          break
        }
      }

      let addingReplicated = false
      for (let i = 0; i < toAdd.length; i++) {
        if (
          world.componentRegistry.getId(toAdd[i] as ComponentLike) ===
          Replicated.id
        ) {
          addingReplicated = true
          break
        }
      }

      if (alreadyReplicated) {
        for (let i = 0; i < toAdd.length; i++) {
          const c = toAdd[i] as ComponentLike
          const id = world.componentRegistry.getId(c)
          // Check if entity already has this component
          let alreadyHas = false
          const elements = node.vec.elements
          for (let k = 0; k < elements.length; k++) {
            if (
              world.componentRegistry.getId(elements[k] as ComponentLike) === id
            ) {
              alreadyHas = true
              break
            }
          }
          if (!alreadyHas) {
            // New component — emit structural "add" op
            const op = poolGetOp("add")
            op.entity = entity
            op.componentId = id
            op.data = getComponentValue(world, entity, c)
            op.rel = world.relations.virtualToRel.get(id)
            world.pendingOps.push(op)
          } else {
            // Value-only change — emit "set" op if P2P mode is enabled
            const config = getResource(world, ReplicationConfig)
            if (config?.emitValueTransactions) {
              const op = poolGetOp("set")
              op.entity = entity
              op.componentId = id
              op.data = getComponentValue(world, entity, c)
              op.version = makeVersion(world.tick, world.registry.domainId)
              op.rel = world.relations.virtualToRel.get(id)
              world.pendingOps.push(op)
            }
          }
        }
      } else if (addingReplicated) {
        const allComponents = [...node.vec.elements, ...toAdd]
        const op = poolGetOp("spawn")
        op.entity = entity
        op.causalKey = makeCausalKey(world.tick, world.tickSpawnCount++)
        op.components = []
        for (let i = 0; i < allComponents.length; i++) {
          const c = allComponents[i] as ComponentLike
          const id = world.componentRegistry.getId(c)
          op.components.push({
            id,
            data: getComponentValue(world, entity, c),
            rel: world.relations.virtualToRel.get(id),
          })
        }
        world.pendingOps.push(op)
      }
    }

    const nextVec = vecSum(
      node.vec,
      makeVec(toAdd, world.componentRegistry),
      world.componentRegistry,
    )
    const nextNode = entityGraphFindOrCreateNode(world.entityGraph, nextVec)
    const prevNode = setEntityNode(world, entity, nextNode)
    recordGraphMove(world, entity, prevNode, nextNode)
  }
}

export function removeComponent(
  world: World,
  entity: Entity,
  item: ComponentLike,
): void {
  const node = entityGraphGetEntityNode(world.entityGraph, entity)
  if (!node) return

  const toRemove: ComponentLike[] = []
  if (isRelationship(item)) {
    const virtualId = getVirtualId(
      world.relations,
      world.componentRegistry.getId(item.relation),
      item.object,
    )
    if (virtualId !== undefined) {
      const vidComp = world.componentRegistry.getVirtualComponent(virtualId)
      toRemove.push(vidComp)
      unregisterIncomingRelation(
        world,
        entity,
        world.componentRegistry.getId(item.relation),
        item.object,
      )

      let hasOtherRelations = false
      const elements = node.vec.elements
      for (let i = 0; i < elements.length; i++) {
        const comp = elements[i] as ComponentLike
        if (
          world.componentRegistry.getId(comp) ===
          world.componentRegistry.getId(vidComp)
        )
          continue
        const rel = world.relations.virtualToRel.get(
          world.componentRegistry.getId(comp),
        )
        if (
          rel &&
          rel.relationId === world.componentRegistry.getId(item.relation)
        ) {
          hasOtherRelations = true
          break
        }
      }

      if (!hasOtherRelations) {
        toRemove.push(item.relation)
      }
    }
  } else {
    toRemove.push(item)
  }

  if (toRemove.length > 0) {
    // Record undo-remove entries for each removed component
    if (getDomainId(entity) !== COMMAND_DOMAIN) {
      for (let i = 0; i < toRemove.length; i++) {
        const c = toRemove[i] as ComponentLike
        const cid = world.componentRegistry.getId(c)
        world.currentUndoEntries.push({
          type: "undo-remove",
          entity,
          componentId: cid,
          data: getComponentValue(world, entity, c),
          rel: world.relations.virtualToRel.get(cid),
        })
      }
    }

    if (getDomainId(entity) === world.registry.domainId) {
      let isReplicated = false
      const elements = node.vec.elements
      for (let i = 0; i < elements.length; i++) {
        if (
          world.componentRegistry.getId(elements[i] as ComponentLike) ===
          Replicated.id
        ) {
          isReplicated = true
          break
        }
      }
      if (isReplicated) {
        for (let i = 0; i < toRemove.length; i++) {
          const c = toRemove[i] as ComponentLike
          const op = poolGetOp("remove")
          op.entity = entity
          op.componentId = world.componentRegistry.getId(c)
          world.pendingOps.push(op)
        }
      }
    }

    for (let i = 0; i < toRemove.length; i++) {
      const c = toRemove[i] as ComponentLike
      if (!c.isTag) {
        let list = world.pendingComponentRemovals.get(entity)
        if (!list) {
          list = []
          world.pendingComponentRemovals.set(entity, list)
        }
        list.push(c)
      }
    }

    const nextVec = vecDifference(
      node.vec,
      makeVec(toRemove, world.componentRegistry),
      world.componentRegistry,
    )
    const nextNode = entityGraphFindOrCreateNode(world.entityGraph, nextVec)
    const prevNode = setEntityNode(world, entity, nextNode)
    recordGraphMove(world, entity, prevNode, nextNode)
  }
}

export function commitTransaction(world: World): void {
  const stream = getResource(world, ReplicationStream)
  if (!stream || world.pendingOps.length === 0) {
    for (let i = 0; i < world.pendingOps.length; i++) {
      poolReturnOp(world.pendingOps[i] as ReplicationOp)
    }
    world.pendingOps.length = 0
    return
  }

  const domainId = world.registry.domainId
  const reducedOps: ReplicationOp[] = []
  const entityToOps = world._reduction_entity_to_ops
  entityToOps.clear()

  for (let i = 0; i < world.pendingOps.length; i++) {
    const op = world.pendingOps[i] as ReplicationOp
    let list = entityToOps.get(op.entity)
    if (!list) {
      list = []
      entityToOps.set(op.entity, list)
    }
    list.push(op)
  }

  for (const [entity, ops] of entityToOps) {
    let wasSpawned = false
    for (let j = 0; j < ops.length; j++) {
      if ((ops[j] as ReplicationOp).type === "spawn") {
        wasSpawned = true
        break
      }
    }
    const isDead = world.pendingDeletions.has(entity)
    if (wasSpawned && isDead) continue

    if (isDead) {
      const op = poolGetOp("despawn")
      op.entity = entity
      reducedOps.push(op)
      continue
    }

    if (wasSpawned) {
      const node = entityGraphGetEntityNode(world.entityGraph, entity)
      if (!node) continue

      let spawnOpOrig: Extract<ReplicationOp, {type: "spawn"}> | undefined
      for (let j = 0; j < ops.length; j++) {
        const op = ops[j] as ReplicationOp
        if (op.type === "spawn") {
          spawnOpOrig = op as Extract<ReplicationOp, {type: "spawn"}>
          break
        }
      }
      if (!spawnOpOrig) continue

      const op = poolGetOp("spawn")
      op.entity = entity
      op.causalKey = spawnOpOrig.causalKey
      op.components = []
      const elements = node.vec.elements
      for (let j = 0; j < elements.length; j++) {
        const c = elements[j] as ComponentLike
        const id = world.componentRegistry.getId(c)
        op.components.push({
          id,
          data: getComponentValue(world, entity, c),
          rel: world.relations.virtualToRel.get(id),
        })
      }
      reducedOps.push(op)
      continue
    }

    const componentChanges = world._reduction_component_changes
    const componentRemovals = world._reduction_component_removals
    componentChanges.clear()
    componentRemovals.clear()

    for (let j = 0; j < ops.length; j++) {
      const op = ops[j] as ReplicationOp
      if (op.type === "add" || op.type === "set") {
        componentChanges.set(op.componentId, op)
        componentRemovals.delete(op.componentId)
      } else if (op.type === "remove") {
        componentRemovals.add(op.componentId)
        componentChanges.delete(op.componentId)
      }
    }

    for (const opOrig of componentChanges.values()) {
      if (opOrig.type === "add") {
        const op = poolGetOp("add")
        op.entity = entity
        op.componentId = opOrig.componentId
        op.data = getComponentValueById(world, entity as number, opOrig.componentId)
        op.rel = opOrig.rel
        reducedOps.push(op)
      } else if (opOrig.type === "set") {
        const op = poolGetOp("set")
        op.entity = entity
        op.componentId = opOrig.componentId
        op.data = getComponentValueById(world, entity as number, opOrig.componentId)
        op.version = opOrig.version
        op.rel = opOrig.rel
        reducedOps.push(op)
      }
    }
    for (const id of componentRemovals) {
      const op = poolGetOp("remove")
      op.entity = entity
      op.componentId = id
      reducedOps.push(op)
    }
  }

  reducedOps.sort((a, b) => {
    if (a.type === "despawn" && b.type !== "despawn") return -1
    if (a.type !== "despawn" && b.type === "despawn") return 1
    return 0
  })

  if (reducedOps.length > 0) {
    stream.transactions.push({
      domainId,
      seq: nextOpSeq(world.registry, domainId),
      tick: world.tick,
      ops: reducedOps,
    })
  }

  for (let i = 0; i < world.pendingOps.length; i++) {
    poolReturnOp(world.pendingOps[i] as ReplicationOp)
  }
  world.pendingOps.length = 0
}

export function advanceTick(world: World, skipSnapshot = false): void {
  const history = getResource(world, HistoryBuffer)

  // Batch undo entries for the current tick (before increment)
  if (history && !skipSnapshot && world.currentUndoEntries.length > 0) {
    history.undoLog.push({
      tick: world.tick,
      ops: [...world.currentUndoEntries],
    })
  }
  world.currentUndoEntries.length = 0

  world.tick++

  if (!skipSnapshot && history) {
    const interval = history.checkpointInterval
    if (interval <= 1 || world.tick % interval === 0) {
      pushCheckpoint(world, history)
    }
  }

  world.tickSpawnCount = 0
}

export function flushGraphChanges(world: World) {
  const batches = world._batch_map as Map<number, EntityGraphBatch>
  batches.clear()

  sparseMapForEach(world.graphChanges, (entity, move) => {
    if (move.from === move.to) return

    const key = createEntityBatchKey(move.from?.id ?? -1, move.to?.id ?? -1)
    let batch = batches.get(key)
    if (!batch) {
      batch = poolGetBatch(move.from, move.to)
      batches.set(key, batch)
    }
    entityGraphBatchAdd(batch, entity as Entity)
  })

  batches.forEach((batch) => {
    if (!batch.prevNode) {
      emitSpawnedEntities(batch)
    } else if (!batch.nextNode) {
      emitDespawnedEntities(batch)
    } else {
      emitMovedEntities(batch, world.componentRegistry)
    }
    poolReturnBatch(batch)
  })

  sparseMapClear(world.graphChanges)

  world.pendingNodePruning.forEach((node) => {
    if (
      node.strategy === PruneStrategy.WhenEmpty &&
      sparseSetSize(node.entities) === 0
    ) {
      entityGraphNodePrune(world.entityGraph, node)
    }
  })
  world.pendingNodePruning.clear()
}

export function flushDeletions(world: World) {
  world.pendingDeletions.forEach((entity) => {
    world.relations.objectToSubjects.delete(entity)

    const entityIndex = sparseMapGet(world.index.entityToIndex, entity)
    if (entityIndex !== undefined) {
      world.index.freeIndices.push(entityIndex)
      sparseMapDelete(world.index.entityToIndex, entity)
    }

    // Remove stale transient registry entries for this entity so that
    // ghost cleanup can never despawn a *different* entity that later
    // reuses the same recycled ID.
    if (getDomainId(entity) === TRANSIENT_DOMAIN) {
      for (const [key, info] of world.transientRegistry.entries()) {
        if (info.entity === entity) {
          world.transientRegistry.delete(key)
        }
      }
    }

    removeEntity(world.registry, entity)
  })

  world.pendingComponentRemovals.forEach((components, entity) => {
    for (let j = 0; j < components.length; j++) {
      deleteComponentValue(world, entity, components[j] as ComponentLike)
    }
  })

  world.pendingDeletions.clear()
  world.pendingComponentRemovals.clear()
}

export function setDomainId(world: World, domainId: number): void {
  world.registry.domainId = domainId
}

export function setTick(world: World, tick: number): void {
  world.tick = tick
}

export function addClockSample(
  world: World,
  t0: number,
  t1: number,
  t2: number,
  agentId = 0,
): void {
  addClocksyncSample(world.clocksync, agentId, t0, t1, t2)
}

export function getClockOffset(world: World): number {
  return getConsensusOffset(world.clocksync)
}

export function getClockRtt(world: World): number {
  return getAverageRtt(world.clocksync)
}
