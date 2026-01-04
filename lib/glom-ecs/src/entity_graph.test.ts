import {describe, expect, test} from "bun:test"
import {define_component} from "./component"
import type {Entity} from "./entity"
import {
  type EntityGraphNode,
  emit_moved_entities,
  emit_spawned_entities,
  entity_graph_batch_add,
  entity_graph_find_or_create_node,
  entity_graph_get_entity_node,
  entity_graph_node_add_listener,
  entity_graph_node_has_entity,
  entity_graph_node_prune,
  entity_graph_set_entity_node,
  make_entity_graph,
  make_entity_graph_batch,
  make_entity_graph_node,
  PruneStrategy,
} from "./entity_graph"
import {make_vec, make_vec_sorted} from "./vec"
import {make_component_registry} from "./registry"
import {sparse_set_size} from "./sparse_set"

describe("entity_graph", () => {
  const c1 = define_component(undefined, 1)
  const c2 = define_component(undefined, 2)
  const c3 = define_component(undefined, 3)
  const registry = make_component_registry({}, [c1, c2, c3])
  const empty_vec = make_vec_sorted([], registry)

  const v1 = make_vec([c1], registry)
  const v12 = make_vec([c1, c2], registry)
  const v123 = make_vec([c1, c2, c3], registry)

  test("make_entity_graph", () => {
    const graph = make_entity_graph(registry)
    expect(graph.root).toBeDefined()
    expect(graph.root.id).toBe(0)
    expect(graph.next_id).toBe(1)
  })

  test("find_or_create_node", () => {
    const graph = make_entity_graph(registry)
    const node1 = entity_graph_find_or_create_node(graph, v1)
    const node2 = entity_graph_find_or_create_node(graph, v1)

    expect(node1).toBe(node2)
    expect(node1.id).toBe(1)
    expect(graph.next_id).toBe(2)
  })

  test("linking logic (subset/superset)", () => {
    const graph = make_entity_graph(registry)
    const n1 = entity_graph_find_or_create_node(graph, v1)
    const n12 = entity_graph_find_or_create_node(graph, v12)

    expect(n1.next_nodes.dense).toContain(n12)
    expect(n12.prev_nodes.dense).toContain(n1)

    const n123 = entity_graph_find_or_create_node(graph, v123)
    expect(n12.next_nodes.dense).toContain(n123)
    expect(n123.prev_nodes.dense).toContain(n12)
    expect(n1.next_nodes.dense).not.toContain(n123)
  })

  test("set_entity_node", () => {
    const graph = make_entity_graph(registry)
    const n1 = entity_graph_find_or_create_node(graph, v1)
    const entity = 100 as Entity

    entity_graph_set_entity_node(graph, entity, n1, entity as unknown as number)
    expect(entity_graph_get_entity_node(graph, entity)).toBe(n1)
    expect(entity_graph_node_has_entity(n1, entity)).toBe(true)

    const n12 = entity_graph_find_or_create_node(graph, v12)
    entity_graph_set_entity_node(
      graph,
      entity,
      n12,
      entity as unknown as number,
    )
    expect(entity_graph_get_entity_node(graph, entity)).toBe(n12)
    expect(entity_graph_node_has_entity(n1, entity)).toBe(false)
    expect(entity_graph_node_has_entity(n12, entity)).toBe(true)
  })

  test("listeners and emit_spawned_entities", () => {
    const graph = make_entity_graph(registry)
    const n1 = entity_graph_find_or_create_node(graph, v1)

    const spawned: Entity[] = []
    entity_graph_node_add_listener(n1, {
      entities_in: (entities) => {
        spawned.push(...entities)
      },
    })

    const batch = make_entity_graph_batch(undefined, n1)
    entity_graph_batch_add(batch, 1 as Entity)
    entity_graph_batch_add(batch, 2 as Entity)

    emit_spawned_entities(batch)
    expect(spawned).toEqual([1 as Entity, 2 as Entity])
  })

  test("emit_moved_entities", () => {
    const graph = make_entity_graph(registry)
    const n1 = entity_graph_find_or_create_node(graph, v1)
    const n12 = entity_graph_find_or_create_node(graph, v12)

    const moved_in: Entity[] = []
    const moved_out: Entity[] = []

    entity_graph_node_add_listener(n12, {
      entities_in: (entities) => moved_in.push(...entities),
      entities_out: (entities) => moved_out.push(...entities),
    })

    const batch1 = make_entity_graph_batch(graph.root, n12)
    entity_graph_batch_add(batch1, 1 as Entity)
    emit_moved_entities(batch1, registry)
    expect(moved_in).toEqual([1 as Entity])

    moved_in.length = 0
    const batch2 = make_entity_graph_batch(n12, n1)
    entity_graph_batch_add(batch2, 1 as Entity)
    emit_moved_entities(batch2, registry)
    expect(moved_out).toEqual([1 as Entity])
  })

  test("node pruning when empty", () => {
    const graph = make_entity_graph(registry)
    const n1 = entity_graph_find_or_create_node(
      graph,
      v1,
      PruneStrategy.WhenEmpty,
    )
    const entity = 1 as Entity

    entity_graph_set_entity_node(graph, entity, n1, entity as unknown as number)
    expect(graph.by_hash.has(v1.hash)).toBe(true)

    entity_graph_set_entity_node(
      graph,
      entity,
      graph.root,
      entity as unknown as number,
    )
    entity_graph_node_prune(graph, n1)
    expect(graph.by_hash.has(v1.hash)).toBe(false)
  })

  test("neighbor reconnection after pruning", () => {
    const graph = make_entity_graph(registry)
    const n1 = entity_graph_find_or_create_node(graph, v1)
    const n12 = entity_graph_find_or_create_node(
      graph,
      v12,
      PruneStrategy.WhenEmpty,
    )
    const n123 = entity_graph_find_or_create_node(graph, v123)

    expect(n1.next_nodes.dense).toContain(n12)
    expect(n123.prev_nodes.dense).toContain(n12)

    const entity = 1 as Entity
    entity_graph_set_entity_node(
      graph,
      entity,
      n12,
      entity as unknown as number,
    )

    entity_graph_set_entity_node(
      graph,
      entity,
      graph.root,
      entity as unknown as number,
    )
    entity_graph_node_prune(graph, n12)

    expect(graph.by_hash.has(v12.hash)).toBe(false)

    expect(n1.next_nodes.dense).toContain(n123)
    expect(n123.prev_nodes.dense).toContain(n1)
  })

  test("root node is never pruned", () => {
    const graph = make_entity_graph(registry)

    graph.root.strategy = PruneStrategy.WhenEmpty

    const entity = 1 as Entity
    entity_graph_set_entity_node(
      graph,
      entity,
      graph.root,
      entity as unknown as number,
    )
    entity_graph_set_entity_node(
      graph,
      entity,
      make_entity_graph_node(99, v1),
      entity as unknown as number,
    )

    expect(graph.by_hash.has(empty_vec.hash)).toBe(true)
  })

  test("node_destroyed callback when pruned", () => {
    const graph = make_entity_graph(registry)
    const n1 = entity_graph_find_or_create_node(
      graph,
      v1,
      PruneStrategy.WhenEmpty,
    )
    const entity = 1 as Entity

    let destroyed_node: EntityGraphNode | null = null
    entity_graph_node_add_listener(graph.root, {
      node_destroyed: (node) => {
        destroyed_node = node
      },
    })

    entity_graph_set_entity_node(graph, entity, n1, entity as unknown as number)
    entity_graph_set_entity_node(
      graph,
      entity,
      graph.root,
      entity as unknown as number,
    )
    entity_graph_node_prune(graph, n1)

    expect(destroyed_node as any).toBe(n1)
  })
})
