import { assert_defined } from "./assert"
import type { Component } from "./component"
import type { Entity } from "./entity"
import { hash_to_uint, hash_word } from "./lib/hash"
import {
  make_sparse_map,
  type SparseMap,
  sparse_map_delete,
  sparse_map_for_each,
  sparse_map_for_each_value,
  sparse_map_set,
} from "./sparse_map"
import {
  make_sparse_set,
  type SparseSet,
  sparse_set_add,
  sparse_set_delete,
  sparse_set_for_each,
  sparse_set_has,
  sparse_set_values,
} from "./sparse_set"
import {
  EMPTY_VEC,
  make_vec,
  type Vec,
  vec_intersection,
  vec_is_superset_of,
  vec_xor_hash,
} from "./vec"

const TRAVERSAL_STACK: (EntityGraphNode | undefined)[] = []
let TRAVERSAL_VERSION = 0

// biome-ignore lint/suspicious/noConfusingVoidType: reason
type EntityGraphNodeIteratee = (node: EntityGraphNode) => boolean | void
export type EntityGraphNodeListener = {
  node_created?: (node: EntityGraphNode) => void
  entities_in?: (entities: Entity[], node: EntityGraphNode) => void
  entities_out?: (entities: Entity[], node: EntityGraphNode) => void
}

export type EntityGraphNode = {
  readonly id: number
  readonly vec: Vec
  readonly entities: SparseSet<Entity>
  readonly next_nodes: SparseMap<EntityGraphNode>
  readonly prev_nodes: SparseMap<EntityGraphNode>
  readonly listeners: EntityGraphNodeListener[]
  _version: number
}

export function make_entity_graph_node(id: number, vec: Vec): EntityGraphNode {
  return {
    id,
    vec,
    entities: make_sparse_set<Entity>(),
    next_nodes: make_sparse_map<EntityGraphNode>(),
    prev_nodes: make_sparse_map<EntityGraphNode>(),
    listeners: [],
    _version: -1,
  }
}

export function entity_graph_node_link(
  node: EntityGraphNode,
  prev: EntityGraphNode,
  xor = vec_xor_hash(node.vec, prev.vec),
): void {
  sparse_map_set(node.prev_nodes, xor, prev)
  sparse_map_set(prev.next_nodes, xor, node)
}

export function entity_graph_node_unlink(
  node: EntityGraphNode,
  prev: EntityGraphNode,
  xor = vec_xor_hash(node.vec, prev.vec),
): void {
  sparse_map_delete(node.prev_nodes, xor)
  sparse_map_delete(prev.next_nodes, xor)
}

export function entity_graph_node_traverse_right(
  start_node: EntityGraphNode,
  iteratee: EntityGraphNodeIteratee,
): void {
  const version = ++TRAVERSAL_VERSION
  let i = 0
  TRAVERSAL_STACK[i++] = start_node
  while (i > 0) {
    const node = TRAVERSAL_STACK[--i]
    if (
      node === undefined ||
      node._version === version ||
      iteratee(node) === false
    ) {
      continue
    }
    node._version = version
    sparse_map_for_each_value(node.next_nodes, (next_node) => {
      TRAVERSAL_STACK[i++] = next_node
    })
  }
}

export function entity_graph_node_traverse_left(
  start_node: EntityGraphNode,
  iteratee: EntityGraphNodeIteratee,
): void {
  const version = ++TRAVERSAL_VERSION
  let i = 0
  TRAVERSAL_STACK[i++] = start_node
  while (i > 0) {
    const node = TRAVERSAL_STACK[--i]
    if (
      node === undefined ||
      node._version === version ||
      iteratee(node) === false
    ) {
      continue
    }
    node._version = version
    sparse_map_for_each_value(node.prev_nodes, (prev_node) => {
      TRAVERSAL_STACK[i++] = prev_node
    })
  }
}

export function entity_graph_node_add_listener(
  node: EntityGraphNode,
  listener: EntityGraphNodeListener,
  emit_existing_nodes = false,
  emit_existing_entities = false,
): void {
  node.listeners.push(listener)
  const on_node_created = listener.node_created?.bind(listener)
  if (emit_existing_nodes && on_node_created) {
    entity_graph_node_traverse_right(node, (next_node) => {
      on_node_created(next_node)
    })
  }
  const on_entities_in = listener.entities_in?.bind(listener)
  if (emit_existing_entities && on_entities_in) {
    entity_graph_node_traverse_right(node, (rightNode) => {
      const entities = sparse_set_values(rightNode.entities)
      if (entities.length > 0) {
        on_entities_in(entities, rightNode)
      }
    })
  }
}

export function entity_graph_node_emit_node_created(
  target: EntityGraphNode,
  node: EntityGraphNode,
): void {
  for (let i = 0; i < target.listeners.length; i++) {
    target.listeners[i]?.node_created?.(node)
  }
}

export function entity_graph_node_emit_entities_in(
  target: EntityGraphNode,
  node: EntityGraphNode,
  entities: Entity[],
): void {
  for (let i = 0; i < target.listeners.length; i++) {
    target.listeners[i]?.entities_in?.(entities, node)
  }
}

export function entity_graph_node_emit_entities_out(
  target: EntityGraphNode,
  node: EntityGraphNode,
  entities: Entity[],
): void {
  for (let i = 0; i < target.listeners.length; i++) {
    target.listeners[i]?.entities_out?.(entities, node)
  }
}

export function entity_graph_node_has_entity(
  node: EntityGraphNode,
  entity: Entity,
): boolean {
  return sparse_set_has(node.entities, entity)
}

export function entity_graph_node_add_entity(
  node: EntityGraphNode,
  entity: Entity,
): void {
  sparse_set_add(node.entities, entity)
}

export function entity_graph_node_remove_entity(
  node: EntityGraphNode,
  entity: Entity,
): void {
  sparse_set_delete(node.entities, entity)
}

export type EntityGraph = {
  next_id: number
  readonly by_hash: Map<number, EntityGraphNode>
  readonly by_entity: (EntityGraphNode | undefined)[]
  readonly root: EntityGraphNode
}

export function make_entity_graph(): EntityGraph {
  return {
    next_id: 1,
    by_hash: new Map(),
    by_entity: [],
    root: make_entity_graph_node(0, EMPTY_VEC),
  }
}

export function entity_graph_link_nodes_traverse(
  graph: EntityGraph,
  node: EntityGraphNode,
): void {
  entity_graph_node_traverse_right(graph.root, (visited) => {
    const is_subset = vec_is_superset_of(node.vec, visited.vec)
    const is_superset = vec_is_superset_of(visited.vec, node.vec)
    if (is_subset) {
      let has_more_specific_subset = false
      sparse_map_for_each_value(visited.next_nodes, (next_node) => {
        if (vec_is_superset_of(node.vec, next_node.vec)) {
          has_more_specific_subset = true
        }
      })
      if (!has_more_specific_subset) {
        entity_graph_node_link(node, visited)
      }
      return true
    }
    if (is_superset) {
      entity_graph_node_link(visited, node)
      sparse_map_for_each(visited.prev_nodes, (xor, prev_node) => {
        if (vec_is_superset_of(node.vec, prev_node.vec)) {
          entity_graph_node_unlink(visited, prev_node, xor)
        }
      })
      return false
    }
    return true
  })
}

export function entity_graph_emit_nodes_traverse(node: EntityGraphNode): void {
  entity_graph_node_traverse_left(node, (visitedNode) => {
    entity_graph_node_emit_node_created(visitedNode, node)
  })
}

export function entity_graph_insert_node(
  graph: EntityGraph,
  node: EntityGraphNode,
): EntityGraphNode {
  graph.by_hash.set(node.vec.hash, node)
  entity_graph_link_nodes_traverse(graph, node)
  entity_graph_emit_nodes_traverse(node)
  return node
}

export function entity_graph_find_or_create_node(
  graph: EntityGraph,
  vec: Vec,
): EntityGraphNode {
  return (
    graph.by_hash.get(vec.hash) ??
    entity_graph_insert_node(
      graph,
      make_entity_graph_node(graph.next_id++, vec),
    )
  )
}

export function entity_graph_find_or_create_node_single(
  graph: EntityGraph,
  component: Component<unknown>,
): EntityGraphNode {
  return (
    graph.by_hash.get(hash_word(undefined, component.id)) ??
    entity_graph_insert_node(
      graph,
      make_entity_graph_node(graph.next_id++, make_vec([component])),
    )
  )
}

export function entity_graph_get_node_by_hash(
  graph: EntityGraph,
  hash: number,
): EntityGraphNode | undefined {
  return graph.by_hash.get(hash)
}

export function entity_graph_get_entity_node(
  graph: EntityGraph,
  entity: Entity,
): EntityGraphNode | undefined {
  return graph.by_entity[entity as number]
}

export function entity_graph_set_entity_node(
  graph: EntityGraph,
  entity: Entity,
  next_node: EntityGraphNode,
): void {
  const prev_node = graph.by_entity[entity as number]
  if (prev_node === next_node) {
    return
  }
  if (prev_node) {
    entity_graph_node_remove_entity(prev_node, entity)
  }
  entity_graph_node_add_entity(next_node, entity)
  graph.by_entity[entity as number] = next_node
}

export type EntityGraphBatch = {
  readonly entities: SparseSet<Entity>
  readonly next_node?: EntityGraphNode
  readonly prev_node?: EntityGraphNode
}

export function make_entity_graph_batch(
  prev_node?: EntityGraphNode,
  next_node?: EntityGraphNode,
): EntityGraphBatch {
  return {
    entities: make_sparse_set<Entity>(),
    next_node,
    prev_node,
  }
}

export function entity_graph_batch_add(
  batch: EntityGraphBatch,
  entity: Entity,
): void {
  sparse_set_add(batch.entities, entity)
}

export function entity_graph_batch_delete(
  batch: EntityGraphBatch,
  entity: Entity,
): void {
  sparse_set_delete(batch.entities, entity)
}

export function entity_graph_batch_each(
  batch: EntityGraphBatch,
  callback: (entity: Entity) => void,
): void {
  sparse_set_for_each(batch.entities, callback)
}

export const createEntityBatchKey = (prev_id: number, next_id: number) => {
  return hash_to_uint(hash_word(hash_word(undefined, prev_id), next_id))
}

export const emit_spawned_entities = (batch: EntityGraphBatch) => {
  const target = batch.next_node
  assert_defined(target)
  entity_graph_node_traverse_left(target, (node) => {
    entity_graph_node_emit_entities_in(
      node,
      target,
      sparse_set_values(batch.entities),
    )
  })
}

export const emit_despawned_entities = (batch: EntityGraphBatch) => {
  const target = batch.prev_node
  assert_defined(target)
  entity_graph_node_traverse_left(target, (node) => {
    entity_graph_node_emit_entities_out(
      node,
      target,
      sparse_set_values(batch.entities),
    )
  })
}

export const emit_moved_entities = (batch: EntityGraphBatch) => {
  const prev_node = batch.prev_node
  const next_node = batch.next_node
  assert_defined(prev_node)
  assert_defined(next_node)
  const intersection = vec_intersection(prev_node.vec, next_node.vec)
  entity_graph_node_traverse_left(next_node, (visit) => {
    if (
      intersection.hash === visit.vec.hash ||
      vec_is_superset_of(intersection, visit.vec)
    ) {
      return false
    }
    entity_graph_node_emit_entities_in(
      visit,
      next_node,
      sparse_set_values(batch.entities),
    )
  })
  entity_graph_node_traverse_left(prev_node, (node) => {
    if (
      intersection.hash === node.vec.hash ||
      vec_is_superset_of(intersection, node.vec)
    ) {
      return false
    }
    entity_graph_node_emit_entities_out(
      node,
      prev_node,
      sparse_set_values(batch.entities),
    )
  })
}
