import {assert_defined} from "./assert"
import type {Component} from "./component"
import type {Entity} from "./entity"
import {hash_to_uint, hash_word} from "./lib/hash"
import type {ComponentRegistry} from "./registry"
import {
  make_sparse_map,
  type SparseMap,
  sparse_map_delete,
  sparse_map_for_each_value,
  sparse_map_get,
  sparse_map_set,
} from "./sparse_map"
import {
  make_sparse_set,
  type SparseSet,
  sparse_set_add,
  sparse_set_clear,
  sparse_set_delete,
  sparse_set_for_each,
  sparse_set_has,
  sparse_set_values,
} from "./sparse_set"
import {
  make_vec,
  make_vec_sorted,
  type Vec,
  vec_intersection,
  vec_is_superset_of,
} from "./vec"

type EntityGraphNodeIteratee = (node: EntityGraphNode) => boolean | void
export type EntityGraphNodeListener = {
  node_created?: (node: EntityGraphNode) => void
  node_destroyed?: (node: EntityGraphNode) => void
  entities_in?: (entities: Entity[], node: EntityGraphNode) => void
  entities_out?: (entities: Entity[], node: EntityGraphNode) => void
}

export enum PruneStrategy {
  None,
  WhenEmpty,
}

export type EntityGraphNode = {
  readonly id: number
  readonly vec: Vec
  readonly entities: SparseSet<Entity>
  readonly next_nodes: SparseMap<EntityGraphNode>
  readonly prev_nodes: SparseMap<EntityGraphNode>
  readonly listeners: EntityGraphNodeListener[]
  readonly strategy: PruneStrategy
}

export function make_entity_graph_node(
  id: number,
  vec: Vec,
  strategy = PruneStrategy.WhenEmpty,
): EntityGraphNode {
  return {
    id,
    vec,
    entities: make_sparse_set<Entity>(),
    next_nodes: make_sparse_map<EntityGraphNode>(),
    prev_nodes: make_sparse_map<EntityGraphNode>(),
    listeners: [],
    strategy,
  }
}

export function entity_graph_node_link(
  node: EntityGraphNode,
  prev: EntityGraphNode,
): void {
  sparse_map_set(node.prev_nodes, prev.id, prev)
  sparse_map_set(prev.next_nodes, node.id, node)
}

export function entity_graph_node_unlink(
  node: EntityGraphNode,
  prev: EntityGraphNode,
): void {
  sparse_map_delete(node.prev_nodes, prev.id)
  sparse_map_delete(prev.next_nodes, node.id)
}

// Use local stacks and Sets to avoid re-entrancy issues with global state
export function entity_graph_node_traverse_right(
  start_node: EntityGraphNode,
  iteratee: EntityGraphNodeIteratee,
): void {
  const stack: (EntityGraphNode | undefined)[] = [start_node]
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
    sparse_map_for_each_value(node.next_nodes, (next_node) => {
      stack.push(next_node)
    })
  }
}

export function entity_graph_node_traverse_left(
  start_node: EntityGraphNode,
  iteratee: EntityGraphNodeIteratee,
): void {
  const stack: (EntityGraphNode | undefined)[] = [start_node]
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
    sparse_map_for_each_value(node.prev_nodes, (prev_node) => {
      stack.push(prev_node)
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

export function entity_graph_node_remove_listener(
  node: EntityGraphNode,
  listener: EntityGraphNodeListener,
): void {
  const index = node.listeners.indexOf(listener)
  if (index !== -1) {
    node.listeners.splice(index, 1)
  }
}

export function entity_graph_node_emit_node_created(
  target: EntityGraphNode,
  node: EntityGraphNode,
): void {
  const listeners = target.listeners
  for (let i = 0; i < listeners.length; i++) {
    listeners[i]?.node_created?.(node)
  }
}

export function entity_graph_node_emit_entities_in(
  target: EntityGraphNode,
  node: EntityGraphNode,
  entities: Entity[],
): void {
  const listeners = target.listeners
  for (let i = 0; i < listeners.length; i++) {
    listeners[i]?.entities_in?.(entities, node)
  }
}

export function entity_graph_node_emit_entities_out(
  target: EntityGraphNode,
  node: EntityGraphNode,
  entities: Entity[],
): void {
  const listeners = target.listeners
  for (let i = 0; i < listeners.length; i++) {
    listeners[i]?.entities_out?.(entities, node)
  }
}

export function entity_graph_node_emit_node_destroyed(
  target: EntityGraphNode,
  node: EntityGraphNode,
): void {
  const listeners = target.listeners
  for (let i = 0; i < listeners.length; i++) {
    listeners[i]?.node_destroyed?.(node)
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

export function entity_graph_node_prune(
  graph: EntityGraph,
  node: EntityGraphNode,
): void {
  if (node === graph.root) {
    return
  }

  const parents: EntityGraphNode[] = []
  sparse_map_for_each_value(node.prev_nodes, (parent) => {
    parents.push(parent)
  })

  const children: EntityGraphNode[] = []
  sparse_map_for_each_value(node.next_nodes, (child) => {
    children.push(child)
  })

  // Notify listeners that this node is destroyed
  entity_graph_node_traverse_left(node, (visitedNode) => {
    entity_graph_node_emit_node_destroyed(visitedNode, node)
  })

  // Unlink from all parents
  for (let i = 0; i < parents.length; i++) {
    entity_graph_node_unlink(node, parents[i] as EntityGraphNode)
  }

  // Unlink from all children
  for (let i = 0; i < children.length; i++) {
    entity_graph_node_unlink(children[i] as EntityGraphNode, node)
  }

  // For each child, potentially link to parents of the pruned node
  for (let i = 0; i < children.length; i++) {
    const child = children[i] as EntityGraphNode
    for (let j = 0; j < parents.length; j++) {
      const parent = parents[j] as EntityGraphNode
      if (vec_is_superset_of(child.vec, parent.vec)) {
        // Check if any other next_nodes of parent are also subsets of child
        let has_more_specific_subset = false
        sparse_map_for_each_value(parent.next_nodes, (nextNode) => {
          if (vec_is_superset_of(child.vec, nextNode.vec)) {
            has_more_specific_subset = true
          }
        })

        if (!has_more_specific_subset) {
          entity_graph_node_link(child, parent)
        }
      }
    }
  }

  graph.by_hash.delete(node.vec.hash)
}

export type EntityGraph = {
  next_id: number
  readonly by_hash: Map<number, EntityGraphNode>
  readonly by_entity: SparseMap<EntityGraphNode>
  readonly root: EntityGraphNode
}

export function make_entity_graph(registry: ComponentRegistry): EntityGraph {
  const empty_vec = make_vec_sorted([], registry)
  const root = make_entity_graph_node(0, empty_vec, PruneStrategy.None)
  const by_hash = new Map<number, EntityGraphNode>()
  by_hash.set(empty_vec.hash, root)
  return {
    next_id: 1,
    by_hash,
    by_entity: make_sparse_map<EntityGraphNode>(),
    root,
  }
}

export function entity_graph_link_nodes_traverse(
  graph: EntityGraph,
  node: EntityGraphNode,
): void {
  const parents_to_link: EntityGraphNode[] = []
  const children_to_link: EntityGraphNode[] = []
  const children_to_unlink: [EntityGraphNode, EntityGraphNode][] = []

  entity_graph_node_traverse_right(graph.root, (visited) => {
    if (node === visited) {
      return true
    }
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
        parents_to_link.push(visited)
      }
      return true
    }
    if (is_superset) {
      children_to_link.push(visited)
      sparse_map_for_each_value(visited.prev_nodes, (prev_node) => {
        if (vec_is_superset_of(node.vec, prev_node.vec)) {
          children_to_unlink.push([visited, prev_node])
        }
      })
      return false
    }
    return true
  })

  for (let i = 0; i < parents_to_link.length; i++) {
    entity_graph_node_link(node, parents_to_link[i] as EntityGraphNode)
  }
  for (let i = 0; i < children_to_unlink.length; i++) {
    const [child, parent] = children_to_unlink[i] as [
      EntityGraphNode,
      EntityGraphNode,
    ]
    entity_graph_node_unlink(child, parent)
  }
  for (let i = 0; i < children_to_link.length; i++) {
    entity_graph_node_link(children_to_link[i] as EntityGraphNode, node)
  }
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
  strategy = PruneStrategy.WhenEmpty,
): EntityGraphNode {
  return (
    graph.by_hash.get(vec.hash) ??
    entity_graph_insert_node(
      graph,
      make_entity_graph_node(graph.next_id++, vec, strategy),
    )
  )
}

export function entity_graph_find_or_create_node_single(
  graph: EntityGraph,
  component: Component<unknown>,
  registry: ComponentRegistry,
  strategy = PruneStrategy.WhenEmpty,
): EntityGraphNode {
  return (
    graph.by_hash.get(hash_word(undefined, registry.get_id(component))) ??
    entity_graph_insert_node(
      graph,
      make_entity_graph_node(
        graph.next_id++,
        make_vec([component], registry),
        strategy,
      ),
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
  return sparse_map_get(graph.by_entity, entity as number)
}

export function entity_graph_for_each_node(
  graph: EntityGraph,
  callback: (node: EntityGraphNode) => void,
): void {
  graph.by_hash.forEach(callback)
}

export function entity_graph_set_entity_node(
  graph: EntityGraph,
  entity: Entity,
  next_node: EntityGraphNode,
): EntityGraphNode | undefined {
  const prev_node = sparse_map_get(graph.by_entity, entity as number)
  if (prev_node === next_node) {
    return prev_node
  }

  if (prev_node) {
    entity_graph_node_remove_entity(prev_node, entity)
  }
  entity_graph_node_add_entity(next_node, entity)
  sparse_map_set(graph.by_entity, entity as number, next_node)
  return prev_node
}

export type EntityGraphBatch = {
  readonly entities: SparseSet<Entity>
  next_node?: EntityGraphNode
  prev_node?: EntityGraphNode
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

const BATCH_POOL: EntityGraphBatch[] = []

export function pool_get_batch(
  prev_node?: EntityGraphNode,
  next_node?: EntityGraphNode,
): EntityGraphBatch {
  const batch = BATCH_POOL.pop()
  if (batch) {
    batch.prev_node = prev_node
    batch.next_node = next_node
    return batch
  }
  return make_entity_graph_batch(prev_node, next_node)
}

export function pool_return_batch(batch: EntityGraphBatch) {
  sparse_set_clear(batch.entities)
  batch.prev_node = undefined
  batch.next_node = undefined
  BATCH_POOL.push(batch)
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

export const create_entity_batch_key = (prev_id: number, next_id: number) => {
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

export const emit_moved_entities = (
  batch: EntityGraphBatch,
  registry: ComponentRegistry,
) => {
  const prev_node = batch.prev_node
  const next_node = batch.next_node
  assert_defined(prev_node)
  assert_defined(next_node)
  const intersection = vec_intersection(prev_node.vec, next_node.vec, registry)
  entity_graph_node_traverse_left(next_node, (visit) => {
    if (vec_is_superset_of(intersection, visit.vec)) {
      return false
    }
    entity_graph_node_emit_entities_in(
      visit,
      next_node,
      sparse_set_values(batch.entities),
    )
  })
  entity_graph_node_traverse_left(prev_node, (node) => {
    if (vec_is_superset_of(intersection, node.vec)) {
      return false
    }
    entity_graph_node_emit_entities_out(
      node,
      prev_node,
      sparse_set_values(batch.entities),
    )
  })
}
