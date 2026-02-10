import {assertDefined} from "./assert"
import type {Component} from "./component"
import type {Entity} from "./entity"
import {hashToUint, hashWord} from "./lib/hash"
import type {ComponentRegistry} from "./registry"
import {
  makeSparseMap,
  type SparseMap,
  sparseMapDelete,
  sparseMapForEachValue,
  sparseMapGet,
  sparseMapSet,
} from "./sparse_map"
import {
  makeSparseSet,
  type SparseSet,
  sparseSetAdd,
  sparseSetClear,
  sparseSetDelete,
  sparseSetForEach,
  sparseSetHas,
  sparseSetIndexOf,
  sparseSetSize,
  sparseSetValues,
} from "./sparse_set"
import {
  makeVec,
  makeVecSorted,
  type Vec,
  vecIntersection,
  vecIsSupersetOf,
} from "./vec"

type EntityGraphNodeIteratee = (node: EntityGraphNode) => boolean | void
export type EntityGraphNodeListener = {
  nodeCreated?: (node: EntityGraphNode) => void
  nodeDestroyed?: (node: EntityGraphNode) => void
  entitiesIn?: (entities: Entity[], node: EntityGraphNode) => void
  entitiesOut?: (entities: Entity[], node: EntityGraphNode) => void
}

export enum PruneStrategy {
  None,
  WhenEmpty,
}

export type RelationMap = {
  subjectToObjects: Map<number, SparseSet<Entity>>
}

export type EntityGraphNode = {
  readonly id: number
  readonly vec: Vec
  readonly entities: SparseSet<Entity>
  readonly indices: number[]
  readonly nextNodes: SparseMap<EntityGraphNode>
  readonly prevNodes: SparseMap<EntityGraphNode>
  readonly relMaps: (RelationMap | undefined)[]
  readonly listeners: EntityGraphNodeListener[]
  readonly strategy: PruneStrategy
}

export function makeEntityGraphNode(
  id: number,
  vec: Vec,
  strategy = PruneStrategy.WhenEmpty,
): EntityGraphNode {
  return {
    id,
    vec,
    entities: makeSparseSet<Entity>(),
    indices: [],
    nextNodes: makeSparseMap<EntityGraphNode>(),
    prevNodes: makeSparseMap<EntityGraphNode>(),
    relMaps: [],
    listeners: [],
    strategy,
  }
}

export function entityGraphNodeAddRelation(
  node: EntityGraphNode,
  relationId: number,
  subject: Entity,
  object: Entity,
): void {
  let relMap = node.relMaps[relationId]
  if (!relMap) {
    relMap = {subjectToObjects: new Map()}
    node.relMaps[relationId] = relMap
  }
  let objects = relMap.subjectToObjects.get(subject as number)
  if (!objects) {
    objects = makeSparseSet<Entity>()
    relMap.subjectToObjects.set(subject as number, objects)
  }
  sparseSetAdd(objects, object)

  entityGraphNodeTraverseLeft(node, (visit) => {
    for (let i = 0; i < visit.listeners.length; i++) {
      visit.listeners[i]?.relationAdded?.(subject, relationId, object, node)
    }
  })
}

export function entityGraphNodeRemoveRelation(
  node: EntityGraphNode,
  relationId: number,
  subject: Entity,
  object: Entity,
): void {
  const relMap = node.relMaps[relationId]
  if (!relMap) return

  const objects = relMap.subjectToObjects.get(subject as number)
  if (!objects) return

  sparseSetDelete(objects, object)
  if (sparseSetSize(objects) === 0) {
    relMap.subjectToObjects.delete(subject as number)
  }

  entityGraphNodeTraverseLeft(node, (visit) => {
    for (let i = 0; i < visit.listeners.length; i++) {
      visit.listeners[i]?.relationRemoved?.(subject, relationId, object, node)
    }
  })
}

export function entityGraphNodeLink(
  node: EntityGraphNode,
  prev: EntityGraphNode,
): void {
  sparseMapSet(node.prevNodes, prev.id, prev)
  sparseMapSet(prev.nextNodes, node.id, node)
}

export function entityGraphNodeUnlink(
  node: EntityGraphNode,
  prev: EntityGraphNode,
): void {
  sparseMapDelete(node.prevNodes, prev.id)
  sparseMapDelete(prev.nextNodes, node.id)
}

export function entityGraphNodeTraverseRight(
  startNode: EntityGraphNode,
  iteratee: EntityGraphNodeIteratee,
): void {
  const stack: (EntityGraphNode | undefined)[] = [startNode]
  const visited = new Set<number>()

  while (stack.length > 0) {
    const node = stack.pop()
    if (
      node === undefined ||
      visited.has(node.id) ||
      iteratee(node) === false
    ) {
      continue
    }
    visited.add(node.id)
    sparseMapForEachValue(node.nextNodes, (nextNode) => {
      stack.push(nextNode)
    })
  }
}

export function entityGraphNodeTraverseLeft(
  startNode: EntityGraphNode,
  iteratee: EntityGraphNodeIteratee,
): void {
  const stack: (EntityGraphNode | undefined)[] = [startNode]
  const visited = new Set<number>()

  while (stack.length > 0) {
    const node = stack.pop()
    if (
      node === undefined ||
      visited.has(node.id) ||
      iteratee(node) === false
    ) {
      continue
    }
    visited.add(node.id)
    sparseMapForEachValue(node.prevNodes, (prevNode) => {
      stack.push(prevNode)
    })
  }
}

export function entityGraphNodeAddListener(
  node: EntityGraphNode,
  listener: EntityGraphNodeListener,
  emitExistingNodes = false,
  emitExistingEntities = false,
): void {
  node.listeners.push(listener)
  const onNodeCreated = listener.nodeCreated?.bind(listener)
  if (emitExistingNodes && onNodeCreated) {
    entityGraphNodeTraverseRight(node, (nextNode) => {
      onNodeCreated(nextNode)
    })
  }
  const onEntitiesIn = listener.entitiesIn?.bind(listener)
  if (emitExistingEntities && onEntitiesIn) {
    entityGraphNodeTraverseRight(node, (rightNode) => {
      const entities = sparseSetValues(rightNode.entities)
      if (entities.length > 0) {
        onEntitiesIn(entities, rightNode)
      }
    })
  }
}

export function entityGraphNodeRemoveListener(
  node: EntityGraphNode,
  listener: EntityGraphNodeListener,
): void {
  const index = node.listeners.indexOf(listener)
  if (index !== -1) {
    node.listeners.splice(index, 1)
  }
}

export function entityGraphNodeEmitNodeCreated(
  target: EntityGraphNode,
  node: EntityGraphNode,
): void {
  for (let i = 0; i < target.listeners.length; i++) {
    target.listeners[i]?.nodeCreated?.(node)
  }
}

export function entityGraphNodeEmitEntitiesIn(
  target: EntityGraphNode,
  node: EntityGraphNode,
  entities: Entity[],
): void {
  for (let i = 0; i < target.listeners.length; i++) {
    target.listeners[i]?.entitiesIn?.(entities, node)
  }
}

export function entityGraphNodeEmitEntitiesOut(
  target: EntityGraphNode,
  node: EntityGraphNode,
  entities: Entity[],
): void {
  for (let i = 0; i < target.listeners.length; i++) {
    target.listeners[i]?.entitiesOut?.(entities, node)
  }
}

export function entityGraphNodeEmitNodeDestroyed(
  target: EntityGraphNode,
  node: EntityGraphNode,
): void {
  for (let i = 0; i < target.listeners.length; i++) {
    target.listeners[i]?.nodeDestroyed?.(node)
  }
}

export function entityGraphNodeHasEntity(
  node: EntityGraphNode,
  entity: Entity,
): boolean {
  return sparseSetHas(node.entities, entity)
}

export function entityGraphNodeAddEntity(
  node: EntityGraphNode,
  entity: Entity,
  index: number,
): void {
  sparseSetAdd(node.entities, entity)
  node.indices.push(index)
}

export function entityGraphNodeRemoveEntity(
  node: EntityGraphNode,
  entity: Entity,
): void {
  const idx = sparseSetIndexOf(node.entities, entity)
  if (idx !== -1) {
    sparseSetDelete(node.entities, entity)
    const lastIdx = node.indices.length - 1
    node.indices[idx] = node.indices[lastIdx]!
    node.indices.pop()
  }
}

export function entityGraphNodePrune(
  graph: EntityGraph,
  node: EntityGraphNode,
): void {
  if (node === graph.root) {
    return
  }

  const parents: EntityGraphNode[] = []
  sparseMapForEachValue(node.prevNodes, (parent) => {
    parents.push(parent)
  })

  const children: EntityGraphNode[] = []
  sparseMapForEachValue(node.nextNodes, (child) => {
    children.push(child)
  })

  entityGraphNodeTraverseLeft(node, (visitedNode) => {
    entityGraphNodeEmitNodeDestroyed(visitedNode, node)
  })

  for (let i = 0; i < parents.length; i++) {
    entityGraphNodeUnlink(node, parents[i] as EntityGraphNode)
  }

  for (let i = 0; i < children.length; i++) {
    entityGraphNodeUnlink(children[i] as EntityGraphNode, node)
  }

  for (let i = 0; i < children.length; i++) {
    const child = children[i] as EntityGraphNode
    for (let j = 0; j < parents.length; j++) {
      const parent = parents[j] as EntityGraphNode
      if (vecIsSupersetOf(child.vec, parent.vec)) {
        let hasMoreSpecificSubset = false
        sparseMapForEachValue(parent.nextNodes, (nextNode) => {
          if (vecIsSupersetOf(child.vec, nextNode.vec)) {
            hasMoreSpecificSubset = true
          }
        })

        if (!hasMoreSpecificSubset) {
          entityGraphNodeLink(child, parent)
        }
      }
    }
  }

  graph.byHash.delete(node.vec.hash)
}

export type EntityGraph = {
  nextId: number
  readonly byHash: Map<number, EntityGraphNode>
  readonly byEntity: SparseMap<EntityGraphNode>
  readonly root: EntityGraphNode
}

export function makeEntityGraph(registry: ComponentRegistry): EntityGraph {
  const emptyVec = makeVecSorted([], registry)
  const root = makeEntityGraphNode(0, emptyVec, PruneStrategy.None)
  const byHash = new Map<number, EntityGraphNode>()
  byHash.set(emptyVec.hash, root)
  return {
    nextId: 1,
    byHash,
    byEntity: makeSparseMap<EntityGraphNode>(),
    root,
  }
}

export function entityGraphLinkNodesTraverse(
  graph: EntityGraph,
  node: EntityGraphNode,
): void {
  const parentsToLink: EntityGraphNode[] = []
  const childrenToLink: EntityGraphNode[] = []
  const childrenToUnlink: [EntityGraphNode, EntityGraphNode][] = []

  entityGraphNodeTraverseRight(graph.root, (visited) => {
    if (node === visited) {
      return true
    }
    const isSubset = vecIsSupersetOf(node.vec, visited.vec)
    const isSuperset = vecIsSupersetOf(visited.vec, node.vec)
    if (isSubset) {
      let hasMoreSpecificSubset = false
      sparseMapForEachValue(visited.nextNodes, (nextNode) => {
        if (vecIsSupersetOf(node.vec, nextNode.vec)) {
          hasMoreSpecificSubset = true
        }
      })
      if (!hasMoreSpecificSubset) {
        parentsToLink.push(visited)
      }
      return true
    }
    if (isSuperset) {
      childrenToLink.push(visited)
      sparseMapForEachValue(visited.prevNodes, (prevNode) => {
        if (vecIsSupersetOf(node.vec, prevNode.vec)) {
          childrenToUnlink.push([visited, prevNode])
        }
      })
      return false
    }
    return true
  })

  for (let i = 0; i < parentsToLink.length; i++) {
    entityGraphNodeLink(node, parentsToLink[i] as EntityGraphNode)
  }
  for (let i = 0; i < childrenToUnlink.length; i++) {
    const [child, parent] = childrenToUnlink[i] as [
      EntityGraphNode,
      EntityGraphNode,
    ]
    entityGraphNodeUnlink(child, parent)
  }
  for (let i = 0; i < childrenToLink.length; i++) {
    entityGraphNodeLink(childrenToLink[i] as EntityGraphNode, node)
  }
}

export function entityGraphEmitNodesTraverse(node: EntityGraphNode): void {
  entityGraphNodeTraverseLeft(node, (visitedNode) => {
    entityGraphNodeEmitNodeCreated(visitedNode, node)
  })
}

export function entityGraphInsertNode(
  graph: EntityGraph,
  node: EntityGraphNode,
): EntityGraphNode {
  graph.byHash.set(node.vec.hash, node)
  entityGraphLinkNodesTraverse(graph, node)
  entityGraphEmitNodesTraverse(node)
  return node
}

export function entityGraphFindOrCreateNode(
  graph: EntityGraph,
  vec: Vec,
  strategy = PruneStrategy.WhenEmpty,
): EntityGraphNode {
  return (
    graph.byHash.get(vec.hash) ??
    entityGraphInsertNode(
      graph,
      makeEntityGraphNode(graph.nextId++, vec, strategy),
    )
  )
}

export function entityGraphFindOrCreateNodeSingle(
  graph: EntityGraph,
  component: Component<unknown>,
  registry: ComponentRegistry,
  strategy = PruneStrategy.WhenEmpty,
): EntityGraphNode {
  return (
    graph.byHash.get(hashWord(undefined, registry.getId(component))) ??
    entityGraphInsertNode(
      graph,
      makeEntityGraphNode(
        graph.nextId++,
        makeVec([component], registry),
        strategy,
      ),
    )
  )
}

export function entityGraphGetNodeByHash(
  graph: EntityGraph,
  hash: number,
): EntityGraphNode | undefined {
  return graph.byHash.get(hash)
}

export function entityGraphGetEntityNode(
  graph: EntityGraph,
  entity: Entity,
): EntityGraphNode | undefined {
  return sparseMapGet(graph.byEntity, entity as number)
}

export function entityGraphForEachNode(
  graph: EntityGraph,
  callback: (node: EntityGraphNode) => void,
): void {
  graph.byHash.forEach(callback)
}

export function entityGraphSetEntityNode(
  graph: EntityGraph,
  entity: Entity,
  nextNode: EntityGraphNode,
  index: number,
): EntityGraphNode | undefined {
  const prevNode = sparseMapGet(graph.byEntity, entity as number)
  if (prevNode === nextNode) {
    return prevNode
  }

  if (prevNode) {
    entityGraphNodeRemoveEntity(prevNode, entity)
  }
  entityGraphNodeAddEntity(nextNode, entity, index)
  sparseMapSet(graph.byEntity, entity as number, nextNode)
  return prevNode
}

export type EntityGraphBatch = {
  readonly entities: SparseSet<Entity>
  nextNode?: EntityGraphNode
  prevNode?: EntityGraphNode
}

export function makeEntityGraphBatch(
  prevNode?: EntityGraphNode,
  nextNode?: EntityGraphNode,
): EntityGraphBatch {
  return {
    entities: makeSparseSet<Entity>(),
    nextNode,
    prevNode,
  }
}

const BATCH_POOL: EntityGraphBatch[] = []

export function poolGetBatch(
  prevNode?: EntityGraphNode,
  nextNode?: EntityGraphNode,
): EntityGraphBatch {
  const batch = BATCH_POOL.pop()
  if (batch) {
    batch.prevNode = prevNode
    batch.nextNode = nextNode
    return batch
  }
  return makeEntityGraphBatch(prevNode, nextNode)
}

export function poolReturnBatch(batch: EntityGraphBatch) {
  sparseSetClear(batch.entities)
  batch.prevNode = undefined
  batch.nextNode = undefined
  BATCH_POOL.push(batch)
}

export function entityGraphBatchAdd(
  batch: EntityGraphBatch,
  entity: Entity,
): void {
  sparseSetAdd(batch.entities, entity)
}

export function entityGraphBatchDelete(
  batch: EntityGraphBatch,
  entity: Entity,
): void {
  sparseSetDelete(batch.entities, entity)
}

export function entityGraphBatchEach(
  batch: EntityGraphBatch,
  callback: (entity: Entity) => void,
): void {
  sparseSetForEach(batch.entities, callback)
}

export const createEntityBatchKey = (prevId: number, nextId: number) => {
  return hashToUint(hashWord(hashWord(undefined, prevId), nextId))
}

export const emitSpawnedEntities = (batch: EntityGraphBatch) => {
  const target = batch.nextNode
  assertDefined(target)
  entityGraphNodeTraverseLeft(target, (node) => {
    entityGraphNodeEmitEntitiesIn(node, target, sparseSetValues(batch.entities))
  })
}

export const emitDespawnedEntities = (batch: EntityGraphBatch) => {
  const target = batch.prevNode
  assertDefined(target)
  entityGraphNodeTraverseLeft(target, (node) => {
    entityGraphNodeEmitEntitiesOut(
      node,
      target,
      sparseSetValues(batch.entities),
    )
  })
}

export const emitMovedEntities = (
  batch: EntityGraphBatch,
  registry: ComponentRegistry,
) => {
  const prevNode = batch.prevNode
  const nextNode = batch.nextNode
  assertDefined(prevNode)
  assertDefined(nextNode)
  const intersection = vecIntersection(prevNode.vec, nextNode.vec, registry)
  entityGraphNodeTraverseLeft(nextNode, (visit) => {
    if (vecIsSupersetOf(intersection, visit.vec)) {
      return false
    }
    entityGraphNodeEmitEntitiesIn(
      visit,
      nextNode,
      sparseSetValues(batch.entities),
    )
  })
  entityGraphNodeTraverseLeft(prevNode, (node) => {
    if (vecIsSupersetOf(intersection, node.vec)) {
      return false
    }
    entityGraphNodeEmitEntitiesOut(
      node,
      prevNode,
      sparseSetValues(batch.entities),
    )
  })
}
