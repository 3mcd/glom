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
  entityGraphNodeAddEntity,
  entityGraphNodeRemoveEntity,
} from "./entity_graph"
import {getDomain, removeEntity} from "./entity_registry"
import {addDomainEntity, removeDomainEntity} from "./entity_registry_domain"
import {acquireWriter} from "./lib/binary"
import {hashWord} from "./lib/hash"
import {Read, World as WorldTerm, Write} from "./query/term"
import {pruneBuffers} from "./reconciliation"
import type {Relation} from "./relation"
import {
  deleteObjectSubjects,
  getObjectSubjects,
  getOrCreateVirtualMap,
  getRelationPair,
  type RelationPair,
  type RelationSubject,
  registerIncomingRelation,
  setRelationPair,
  unregisterIncomingRelation,
} from "./relation_registry"
import {writeSnapshot} from "./snapshot_stream"
import {sparseMapDelete, sparseMapGet, sparseMapSet} from "./sparse_map"
import {defineSystem} from "./system"
import {makeVec, vecDifference, vecSum} from "./vec"
import {
  deleteComponentValue,
  getComponentId,
  getComponentValue,
  getEntityNode,
  getResource,
  resolveComponent,
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
  if (op !== undefined) {
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

  const node = getEntityNode(world, transient)
  if (node !== undefined) {
    entityGraphNodeRemoveEntity(node, transient)
    entityGraphNodeAddEntity(node, authoritative, index)
    sparseMapSet(world.graph.byEntity, authoritative as number, node)
    sparseMapDelete(world.graph.byEntity, transient as number)
  }

  const incoming = getObjectSubjects(world, transient as number)
  if (incoming !== undefined) {
    const relationsToMove = Array.from(incoming)
    for (let i = 0; i < relationsToMove.length; i++) {
      const {subject, relationId} = relationsToMove[i] as RelationSubject
      const relation = ((object: Entity) => ({
        relation: resolveComponent(world, relationId) as Relation,
        object,
      })) as unknown as (object: Entity) => ComponentLike

      removeComponent(world, subject as Entity, relation(transient))

      addComponent(world, subject as Entity, relation(authoritative))
    }
    deleteObjectSubjects(world, transient as number)
  }

  const commandBuffer = getResource(world, CommandBuffer)
  if (commandBuffer !== undefined) {
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

  for (let i = 0; i < transaction.ops.length; i++) {
    const op = transaction.ops[i] as ReplicationOp
    switch (op.type) {
      case "spawn": {
        if (op.causalKey !== undefined) {
          const transientInfo = world.transients.get(op.causalKey)
          if (transientInfo !== undefined) {
            rebindEntity(world, transientInfo.entity, op.entity)

            world.transients.set(op.causalKey, {
              ...transientInfo,
              entity: op.entity,
            })
          }
        }

        addDomainEntity(domain, op.entity)

        // Ensure the entity's actual domain (encoded in the entity ID) has
        // its entityId counter advanced past this entity's localId.  Without
        // this, a client that later allocates entities in the same domain
        // (e.g. TRANSIENT_DOMAIN) can produce a colliding entity ID.
        const entityDomainId = getDomainId(op.entity)
        if (entityDomainId !== transaction.domainId) {
          const entityDomain = getDomain(world.registry, entityDomainId)
          const localId = getLocalId(op.entity)
          if (entityDomain.entityId <= localId) {
            entityDomain.entityId = localId + 1
          }
        }

        const resolved: ComponentLike[] = []
        for (let j = 0; j < op.components.length; j++) {
          const {id, data, rel} = op.components[j] as SpawnComponent
          const comp = resolveComponent(world, id)
          if (comp === undefined) continue

          if (data !== undefined) {
            setComponentValue(
              world,
              op.entity,
              comp as Component<unknown>,
              data,
              transaction.tick,
            )
          }
          resolved.push(comp)

          if (rel !== undefined) {
            getOrCreateVirtualMap(world, rel.relationId).set(rel.object, id)
            setRelationPair(world, id, rel)
            registerIncomingRelation(
              world,
              op.entity,
              rel.relationId,
              rel.object as Entity,
            )
          }
        }
        setEntityNode(
          world,
          op.entity,
          entityGraphFindOrCreateNode(
            world.graph,
            makeVec(resolved, world.componentRegistry),
          ),
        )

        // Record undo entry for server-applied spawn
        world.undoOps.push({type: "undo-spawn", entity: op.entity})
        break
      }
      case "despawn": {
        const node = getEntityNode(world, op.entity)
        if (node === undefined) break

        // Record undo entry before cleanup
        {
          const undoComponents: SpawnComponent[] = []
          const els = node.vec.elements
          for (let k = 0; k < els.length; k++) {
            const comp = els[k] as ComponentLike
            const compId = getComponentId(world, comp)
            undoComponents.push({
              id: compId,
              data: getComponentValue(world, op.entity, comp),
              rel: getRelationPair(world, compId),
            })
          }
          world.undoOps.push({
            type: "undo-despawn",
            entity: op.entity,
            components: undoComponents,
          })
        }

        deleteObjectSubjects(world, op.entity as number)

        const elements = node.vec.elements
        for (let j = 0; j < elements.length; j++) {
          const comp = elements[j] as ComponentLike
          const compId = getComponentId(world, comp)
          const rel = getRelationPair(world, compId)
          if (rel !== undefined) {
            unregisterIncomingRelation(
              world,
              op.entity,
              rel.relationId,
              rel.object as Entity,
            )
          }
          deleteComponentValue(world, op.entity, comp)
        }

        const prevNode = setEntityNode(world, op.entity, world.graph.root)
        if (prevNode !== undefined) {
          world.pendingPrunes.add(prevNode)
        }
        removeDomainEntity(domain, op.entity)
        break
      }
      case "set": {
        const comp = resolveComponent(world, op.componentId)
        if (comp === undefined) break
        const node = getEntityNode(world, op.entity)
        if (node === undefined) break

        setComponentValue(
          world,
          op.entity,
          comp as Component<unknown>,
          op.data,
          op.version ?? transaction.tick,
        )

        if (op.rel !== undefined) {
          getOrCreateVirtualMap(world, op.rel.relationId).set(
            op.rel.object,
            op.componentId,
          )
          setRelationPair(world, op.componentId, op.rel)
          registerIncomingRelation(
            world,
            op.entity,
            op.rel.relationId,
            op.rel.object as Entity,
          )
        }

        let hasComp = false
        for (let j = 0; j < node.vec.elements.length; j++) {
          if (
            getComponentId(world, node.vec.elements[j] as ComponentLike) ===
            op.componentId
          ) {
            hasComp = true
            break
          }
        }

        if (!hasComp) {
          // Record undo entry for server-applied component add
          world.undoOps.push({
            type: "undo-add",
            entity: op.entity,
            componentId: op.componentId,
            rel: op.rel,
          })

          const nextNode = entityGraphFindOrCreateNode(
            world.graph,
            vecSum(
              node.vec,
              makeVec([comp], world.componentRegistry),
              world.componentRegistry,
            ),
          )
          const prevNode = setEntityNode(world, op.entity, nextNode)
          if (prevNode !== undefined) {
            world.pendingPrunes.add(prevNode)
          }
        }
        break
      }
      case "remove": {
        const comp = resolveComponent(world, op.componentId)
        if (comp === undefined) break
        const node = getEntityNode(world, op.entity)
        if (node === undefined) break

        // Record undo entry before deleting component data
        world.undoOps.push({
          type: "undo-remove",
          entity: op.entity,
          componentId: op.componentId,
          data: getComponentValue(world, op.entity, comp),
          rel: getRelationPair(world, op.componentId),
        })

        const relInfo = getRelationPair(world, op.componentId)
        if (relInfo !== undefined) {
          unregisterIncomingRelation(
            world,
            op.entity,
            relInfo.relationId,
            relInfo.object as Entity,
          )
        }

        deleteComponentValue(world, op.entity, comp)

        const nextNode = entityGraphFindOrCreateNode(
          world.graph,
          vecDifference(
            node.vec,
            makeVec([comp], world.componentRegistry),
            world.componentRegistry,
          ),
        )
        const prevNode = setEntityNode(world, op.entity, nextNode)
        if (prevNode !== undefined) {
          world.pendingPrunes.add(prevNode)
        }
        break
      }
      case "add": {
        const comp = resolveComponent(world, op.componentId)
        if (comp === undefined) break
        const node = getEntityNode(world, op.entity)
        if (node === undefined) break

        if (op.data !== undefined) {
          setComponentValue(
            world,
            op.entity,
            comp as Component<unknown>,
            op.data,
            transaction.tick,
          )
        }

        if (op.rel !== undefined) {
          getOrCreateVirtualMap(world, op.rel.relationId).set(
            op.rel.object,
            op.componentId,
          )
          setRelationPair(world, op.componentId, op.rel)
          registerIncomingRelation(
            world,
            op.entity,
            op.rel.relationId,
            op.rel.object as Entity,
          )
        }

        let hasComp = false
        for (let j = 0; j < node.vec.elements.length; j++) {
          if (
            getComponentId(world, node.vec.elements[j] as ComponentLike) ===
            op.componentId
          ) {
            hasComp = true
            break
          }
        }

        if (!hasComp) {
          // Record undo entry for server-applied component add
          world.undoOps.push({
            type: "undo-add",
            entity: op.entity,
            componentId: op.componentId,
            rel: op.rel,
          })

          const nextNode = entityGraphFindOrCreateNode(
            world.graph,
            vecSum(
              node.vec,
              makeVec([comp], world.componentRegistry),
              world.componentRegistry,
            ),
          )
          const prevNode = setEntityNode(world, op.entity, nextNode)
          if (prevNode !== undefined) {
            world.pendingPrunes.add(prevNode)
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
    config: Read<typeof ReplicationConfig>,
    stream: Write<typeof ReplicationStream>,
    world: World,
  ) => {
    if (config.snapshotComponents === undefined) return
    if (
      (config.snapshotInterval ?? 1) > 1 &&
      world.tick % (config.snapshotInterval ?? 1) !== 0
    )
      return
    // Write directly to a pooled ByteWriter
    const writer = acquireWriter()
    writeSnapshot(
      writer,
      world,
      config.snapshotComponents,
      world.componentRegistry,
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
  (config: Read<typeof ReplicationConfig>, world: World) => {
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
