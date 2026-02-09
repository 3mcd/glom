import type {Component, ComponentLike} from "./component"
import {
  Replicated,
  ReplicationConfig,
  ReplicationStream,
} from "./replication_config"
export {Replicated, ReplicationConfig, ReplicationStream}

import {CommandBuffer, type CommandInstance} from "./command"
import {type Entity, getDomainId, getLocalId} from "./entity"
import {
  entityGraphFindOrCreateNode,
  entityGraphGetEntityNode,
  entityGraphNodeAddEntity,
  entityGraphNodeRemoveEntity,
} from "./entity_graph"
import {getDomain, removeEntity} from "./entity_registry"
import {addDomainEntity, removeDomainEntity} from "./entity_registry_domain"
import {hashWord} from "./lib/hash"
import {Read, World as WorldTerm, Write} from "./query/term"
import {pruneBuffers} from "./reconciliation"
import type {Relation} from "./relation"
import {
  type RelationPair,
  type RelationSubject,
  registerIncomingRelation,
  unregisterIncomingRelation,
} from "./relation_registry"
import {captureSnapshotStream, writeSnapshot} from "./snapshot_stream"
import {acquireWriter} from "./lib/binary"
import {sparseMapDelete, sparseMapGet, sparseMapSet} from "./sparse_map"
import {defineSystem} from "./system"
import {makeVec, vecDifference, vecSum} from "./vec"
import {
  deleteComponentValue,
  getComponentValue,
  getResource,
  setComponentValue,
  type World,
} from "./world"
import {
  addComponent,
  advanceTick,
  commitTransaction,
  removeComponent,
  setEntityNode,
} from "./world_api"

export const TRANSIENT_DOMAIN = 2046
export const COMMAND_DOMAIN = 2047

export type SpawnComponent = {
  id: number
  data?: unknown
  rel?: RelationPair
}

export type SpawnOp = {
  type: "spawn"
  entity: Entity
  components: SpawnComponent[]
  causalKey?: number
}

export type DespawnOp = {type: "despawn"; entity: Entity}

export type SetOp = {
  type: "set"
  entity: Entity
  componentId: number
  data: unknown
  version?: number
  rel?: RelationPair
}

export type RemoveOp = {type: "remove"; entity: Entity; componentId: number}

export type AddOp = {
  type: "add"
  entity: Entity
  componentId: number
  data?: unknown
  rel?: RelationPair
}

export type ReplicationOp = SpawnOp | DespawnOp | SetOp | RemoveOp | AddOp

export type Transaction = {
  domainId: number
  seq: number
  tick: number
  ops: ReplicationOp[]
}

export type ReplicationRecorder = (transaction: Transaction) => void

const OP_POOL: ReplicationOp[] = []

export function poolGetOp<T extends ReplicationOp["type"]>(
  type: T,
): Extract<ReplicationOp, {type: T}> {
  const op = OP_POOL.pop()
  if (op) {
    const mutableOp = op as {type: string}
    mutableOp.type = type
    return op as Extract<ReplicationOp, {type: T}>
  }
  return {type} as unknown as Extract<ReplicationOp, {type: T}>
}

export function poolReturnOp(op: ReplicationOp) {
  if (op.type === "spawn") {
    op.components.length = 0
  }
  OP_POOL.push(op)
}

export function makeCausalKey(tick: number, spawnIndex: number): number {
  return hashWord(tick, spawnIndex) >>> 0
}

export function rebindEntity(
  world: World,
  transient: Entity,
  authoritative: Entity,
) {
  if (transient === authoritative) return



  const index = sparseMapGet(world.index.entityToIndex, transient)
  if (index === undefined) {
    return
  }

  removeEntity(world.registry, transient)

  sparseMapSet(world.index.entityToIndex, authoritative, index)
  world.index.indexToEntity[index] = authoritative
  sparseMapDelete(world.index.entityToIndex, transient)

  const node = sparseMapGet(world.entityGraph.byEntity, transient as number)
  if (node) {
    entityGraphNodeRemoveEntity(node, transient)
    entityGraphNodeAddEntity(node, authoritative, index)
    sparseMapSet(world.entityGraph.byEntity, authoritative as number, node)
    sparseMapDelete(world.entityGraph.byEntity, transient as number)
  }

  const incoming = world.relations.objectToSubjects.get(transient)
  if (incoming) {
    const relationsToMove = Array.from(incoming)
    for (let i = 0; i < relationsToMove.length; i++) {
      const {subject, relationId} = relationsToMove[i] as RelationSubject
      const relation = ((object: Entity) => ({
        relation: world.componentRegistry.getComponent(relationId) as Relation,
        object,
      })) as unknown as (object: Entity) => ComponentLike

      removeComponent(world, subject as Entity, relation(transient))

      addComponent(world, subject as Entity, relation(authoritative))
    }
    world.relations.objectToSubjects.delete(transient)
  }

  const commandBuffer = getResource(world, CommandBuffer)
  if (commandBuffer) {
    const cmdBuffers = Array.from(commandBuffer.values())
    for (let i = 0; i < cmdBuffers.length; i++) {
      const commands = cmdBuffers[i] as CommandInstance[]
      for (let j = 0; j < commands.length; j++) {
        const cmd = commands[j] as CommandInstance
        if (cmd.target === transient) {
          cmd.target = authoritative
        }
      }
    }
  }
}

export function applyTransaction(world: World, transaction: Transaction) {
  const domain = getDomain(world.registry, transaction.domainId)

  if (transaction.seq !== domain.opSeq) {
    console.warn(
      `Out of order batch for domain ${transaction.domainId}: expected ${domain.opSeq}, got ${transaction.seq}`,
    )
  }

  const ops = transaction.ops
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i] as ReplicationOp
    switch (op.type) {
      case "spawn": {
        const entity = op.entity

        if (op.causalKey !== undefined) {
          const transientInfo = world.transientRegistry.get(op.causalKey)
          if (transientInfo !== undefined) {
            rebindEntity(world, transientInfo.entity, entity)

            world.transientRegistry.set(op.causalKey, {
              ...transientInfo,
              entity,
            })
          }
        }

        addDomainEntity(domain, entity)

        // Ensure the entity's actual domain (encoded in the entity ID) has
        // its entityId counter advanced past this entity's localId.  Without
        // this, a client that later allocates entities in the same domain
        // (e.g. TRANSIENT_DOMAIN) can produce a colliding entity ID.
        const entityDomainId = getDomainId(entity)
        if (entityDomainId !== transaction.domainId) {
          const entityDomain = getDomain(world.registry, entityDomainId)
          const localId = getLocalId(entity)
          if (entityDomain.entityId <= localId) {
            entityDomain.entityId = localId + 1
          }
        }

        const resolved: ComponentLike[] = []
        const components = op.components
        for (let j = 0; j < components.length; j++) {
          const {id, data, rel} = components[j] as SpawnComponent
          const comp = world.componentRegistry.getComponent(id)
          if (!comp) continue

          if (data !== undefined) {
            setComponentValue(
              world,
              entity,
              comp as Component<unknown>,
              data,
              transaction.tick,
            )
          }
          resolved.push(comp)

          if (rel) {
            let relMap = world.relations.relToVirtual.get(rel.relationId)
            if (!relMap) {
              relMap = new Map()
              world.relations.relToVirtual.set(rel.relationId, relMap)
            }
            relMap.set(rel.object, id)
            world.relations.virtualToRel.set(id, rel)

            registerIncomingRelation(
              world,
              entity,
              rel.relationId,
              rel.object as Entity,
            )
          }
        }
        const node = entityGraphFindOrCreateNode(
          world.entityGraph,
          makeVec(resolved, world.componentRegistry),
        )

        setEntityNode(world, entity, node)

        // Record undo entry for server-applied spawn
        world.currentUndoEntries.push({type: "undo-spawn", entity})
        break
      }
      case "despawn": {
        const node = entityGraphGetEntityNode(world.entityGraph, op.entity)
        if (!node) break

        // Record undo entry before cleanup
        {
          const undoComponents: SpawnComponent[] = []
          const els = node.vec.elements
          for (let k = 0; k < els.length; k++) {
            const comp = els[k] as ComponentLike
            const compId = world.componentRegistry.getId(comp)
            undoComponents.push({
              id: compId,
              data: getComponentValue(world, op.entity, comp),
              rel: world.relations.virtualToRel.get(compId),
            })
          }
          world.currentUndoEntries.push({
            type: "undo-despawn",
            entity: op.entity,
            components: undoComponents,
          })
        }

        const incoming = world.relations.objectToSubjects.get(op.entity)
        if (incoming) {
          world.relations.objectToSubjects.delete(op.entity)
        }

        const elements = node.vec.elements
        for (let j = 0; j < elements.length; j++) {
          const comp = elements[j] as ComponentLike
          const compId = world.componentRegistry.getId(comp)
          const rel = world.relations.virtualToRel.get(compId)
          if (rel) {
            unregisterIncomingRelation(
              world,
              op.entity,
              rel.relationId,
              rel.object as Entity,
            )
          }
          deleteComponentValue(world, op.entity, comp)
        }

        const prevNode = setEntityNode(world, op.entity, world.entityGraph.root)
        if (prevNode) {
          world.pendingNodePruning.add(prevNode)
        }
        removeDomainEntity(domain, op.entity)
        break
      }
      case "set": {
        const entity = op.entity
        const comp = world.componentRegistry.getComponent(op.componentId)
        if (!comp) break
        const node = entityGraphGetEntityNode(world.entityGraph, entity)
        if (!node) break

        setComponentValue(
          world,
          entity,
          comp as Component<unknown>,
          op.data,
          op.version ?? transaction.tick,
        )

        if (op.rel) {
          const rel = op.rel
          const id = op.componentId

          let relMap = world.relations.relToVirtual.get(rel.relationId)
          if (!relMap) {
            relMap = new Map()
            world.relations.relToVirtual.set(rel.relationId, relMap)
          }
          relMap.set(rel.object, id)
          world.relations.virtualToRel.set(id, rel)

          registerIncomingRelation(
            world,
            entity,
            rel.relationId,
            rel.object as Entity,
          )
        }

        let hasComp = false
        const elements = node.vec.elements
        for (let j = 0; j < elements.length; j++) {
          if (
            world.componentRegistry.getId(elements[j] as ComponentLike) ===
            op.componentId
          ) {
            hasComp = true
            break
          }
        }

        if (!hasComp) {
          // Record undo entry for server-applied component add
          world.currentUndoEntries.push({
            type: "undo-add",
            entity,
            componentId: op.componentId,
            rel: op.rel,
          })

          const nextNode = entityGraphFindOrCreateNode(
            world.entityGraph,
            vecSum(
              node.vec,
              makeVec([comp], world.componentRegistry),
              world.componentRegistry,
            ),
          )
          const prevNode = setEntityNode(world, entity, nextNode)
          if (prevNode) {
            world.pendingNodePruning.add(prevNode)
          }
        }
        break
      }
      case "remove": {
        const entity = op.entity
        const id = op.componentId
        const comp = world.componentRegistry.getComponent(id)
        if (!comp) break
        const node = entityGraphGetEntityNode(world.entityGraph, entity)
        if (!node) break

        // Record undo entry before deleting component data
        world.currentUndoEntries.push({
          type: "undo-remove",
          entity,
          componentId: id,
          data: getComponentValue(world, entity, comp),
          rel: world.relations.virtualToRel.get(id),
        })

        const relInfo = world.relations.virtualToRel.get(id)
        if (relInfo) {
          unregisterIncomingRelation(
            world,
            entity,
            relInfo.relationId,
            relInfo.object as Entity,
          )
        }

        deleteComponentValue(world, entity, comp)

        const nextNode = entityGraphFindOrCreateNode(
          world.entityGraph,
          vecDifference(
            node.vec,
            makeVec([comp], world.componentRegistry),
            world.componentRegistry,
          ),
        )
        const prevNode = setEntityNode(world, entity, nextNode)
        if (prevNode) {
          world.pendingNodePruning.add(prevNode)
        }
        break
      }
      case "add": {
        const entity = op.entity
        const comp = world.componentRegistry.getComponent(op.componentId)
        if (!comp) break
        const node = entityGraphGetEntityNode(world.entityGraph, entity)
        if (!node) break

        if (op.data !== undefined) {
          setComponentValue(
            world,
            entity,
            comp as Component<unknown>,
            op.data,
            transaction.tick,
          )
        }

        if (op.rel) {
          const rel = op.rel
          const id = op.componentId

          let relMap = world.relations.relToVirtual.get(rel.relationId)
          if (!relMap) {
            relMap = new Map()
            world.relations.relToVirtual.set(rel.relationId, relMap)
          }
          relMap.set(rel.object, id)
          world.relations.virtualToRel.set(id, rel)

          registerIncomingRelation(
            world,
            entity,
            rel.relationId,
            rel.object as Entity,
          )
        }

        let hasComp = false
        const elements = node.vec.elements
        for (let j = 0; j < elements.length; j++) {
          if (
            world.componentRegistry.getId(elements[j] as ComponentLike) ===
            op.componentId
          ) {
            hasComp = true
            break
          }
        }

        if (!hasComp) {
          // Record undo entry for server-applied component add
          world.currentUndoEntries.push({
            type: "undo-add",
            entity,
            componentId: op.componentId,
            rel: op.rel,
          })

          const nextNode = entityGraphFindOrCreateNode(
            world.entityGraph,
            vecSum(
              node.vec,
              makeVec([comp], world.componentRegistry),
              world.componentRegistry,
            ),
          )
          const prevNode = setEntityNode(world, entity, nextNode)
          if (prevNode) {
            world.pendingNodePruning.add(prevNode)
          }
        }
        break
      }
    }
  }

  domain.opSeq = transaction.seq + 1
}

export const commitPendingMutations = defineSystem(
  (world: World) => {
    commitTransaction(world)
  },
  {params: [WorldTerm()], name: "commitPendingMutations"},
)

export const emitSnapshots = defineSystem(
  (
    config: typeof ReplicationConfig,
    stream: Write<typeof ReplicationStream>,
    world: World,
  ) => {
    if (!config.snapshotComponents) return
    const interval = config.snapshotInterval ?? 1
    if (interval > 1 && world.tick % interval !== 0) return
    // Write directly to a pooled ByteWriter — no intermediate SnapshotBlock objects
    const writer = acquireWriter()
    writeSnapshot(
      writer,
      world,
      config.snapshotComponents,
      world,
      world.tick,
    )
    if (writer.getLength() > 7) {
      // >7 means more than header (5 bytes) + blockCount of 0 (2 bytes)
      stream.snapshots.push(writer.toBytes())
    }
  },
  {
    params: [Read(ReplicationConfig), Write(ReplicationStream), WorldTerm()],
    name: "emitSnapshots",
  },
)

export const pruneTemporalBuffers = defineSystem(
  (config: typeof ReplicationConfig, world: World) => {
    const window = config.historyWindow ?? 64
    const minTick = world.tick - window
    if (minTick > 0) {
      pruneBuffers(world, minTick)
    }
  },
  {
    params: [Read(ReplicationConfig), WorldTerm()],
    name: "pruneTemporalBuffers",
  },
)

export const advanceWorldTick = defineSystem(
  (world: World) => {
    advanceTick(world)
  },
  {params: [WorldTerm()], name: "advanceWorldTick"},
)

export const clearReplicationStream = defineSystem(
  (stream: Write<typeof ReplicationStream>) => {
    stream.transactions.length = 0
    stream.snapshots.length = 0
  },
  {
    params: [Write(ReplicationStream)],
    name: "clearReplicationStream",
  },
)
