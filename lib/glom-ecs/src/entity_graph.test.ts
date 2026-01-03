import { describe, expect, test } from "bun:test"
import { define_component } from "./component"
import type { Entity } from "./entity"
import {
  emit_moved_entities,
  emit_spawned_entities,
  entity_graph_batch_add,
  entity_graph_find_or_create_node,
  entity_graph_get_entity_node,
  entity_graph_node_add_listener,
  entity_graph_node_has_entity,
  entity_graph_set_entity_node,
  make_entity_graph,
  make_entity_graph_batch,
  make_entity_graph_node,
  PruneStrategy,
} from "./entity_graph"
import { EMPTY_VEC, make_vec } from "./vec"

describe("entity_graph", () => {
  const c1 = define_component(1)
  const c2 = define_component(2)
  const c3 = define_component(3)

  const v1 = make_vec([c1])
  const v12 = make_vec([c1, c2])
  const v123 = make_vec([c1, c2, c3])

  test("make_entity_graph", () => {
    const graph = make_entity_graph()
    expect(graph.root).toBeDefined()
    expect(graph.root.id).toBe(0)
    expect(graph.next_id).toBe(1)
  })

  test("find_or_create_node", () => {
    const graph = make_entity_graph()
    const node1 = entity_graph_find_or_create_node(graph, v1)
    const node2 = entity_graph_find_or_create_node(graph, v1)

    expect(node1).toBe(node2)
    expect(node1.id).toBe(1)
    expect(graph.next_id).toBe(2)
  })

  test("linking logic (subset/superset)", () => {
    const graph = make_entity_graph()
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
    const graph = make_entity_graph()
    const n1 = entity_graph_find_or_create_node(graph, v1)
    const entity = 100 as Entity

    entity_graph_set_entity_node(graph, entity, n1)
    expect(entity_graph_get_entity_node(graph, entity)).toBe(n1)
    expect(entity_graph_node_has_entity(n1, entity)).toBe(true)

    const n12 = entity_graph_find_or_create_node(graph, v12)
    entity_graph_set_entity_node(graph, entity, n12)
    expect(entity_graph_get_entity_node(graph, entity)).toBe(n12)
    expect(entity_graph_node_has_entity(n1, entity)).toBe(false)
    expect(entity_graph_node_has_entity(n12, entity)).toBe(true)
  })

  test("listeners and emit_spawned_entities", () => {
    const graph = make_entity_graph()
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
    const graph = make_entity_graph()
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
    emit_moved_entities(batch1)
    expect(moved_in).toEqual([1 as Entity])

    moved_in.length = 0
    const batch2 = make_entity_graph_batch(n12, n1)
    entity_graph_batch_add(batch2, 1 as Entity)
    emit_moved_entities(batch2)
    expect(moved_out).toEqual([1 as Entity])
  })

  test("node pruning when empty", () => {
    const graph = make_entity_graph()
    const n1 = entity_graph_find_or_create_node(
      graph,
      v1,
      PruneStrategy.WhenEmpty,
    )
    const entity = 1 as Entity

    entity_graph_set_entity_node(graph, entity, n1)
    expect(graph.by_hash.has(v1.hash)).toBe(true)

    // Move away from n1 - should prune it
    entity_graph_set_entity_node(graph, entity, graph.root)
    expect(graph.by_hash.has(v1.hash)).toBe(false)
  })

  test("neighbor reconnection after pruning", () => {
    const graph = make_entity_graph()
    const n1 = entity_graph_find_or_create_node(graph, v1) // Strategy None
    const n12 = entity_graph_find_or_create_node(
      graph,
      v12,
      PruneStrategy.WhenEmpty,
    )
    const n123 = entity_graph_find_or_create_node(graph, v123) // Strategy None

    expect(n1.next_nodes.dense).toContain(n12)
    expect(n123.prev_nodes.dense).toContain(n12)

    const entity = 1 as Entity
    entity_graph_set_entity_node(graph, entity, n12)

    // Prune n12 by moving entity away
    entity_graph_set_entity_node(graph, entity, graph.root)

    expect(graph.by_hash.has(v12.hash)).toBe(false)

    // n1 and n123 should now be directly linked
    expect(n1.next_nodes.dense).toContain(n123)
    expect(n123.prev_nodes.dense).toContain(n1)
  })

  test("root node is never pruned", () => {
    const graph = make_entity_graph()
    // Root doesn't have entities normally but let's test the strategy if it were set
    // @ts-ignore: private access for test
    graph.root.strategy = PruneStrategy.WhenEmpty

    const entity = 1 as Entity
    entity_graph_set_entity_node(graph, entity, graph.root)
    entity_graph_set_entity_node(graph, entity, make_entity_graph_node(99, v1))

    expect(graph.by_hash.has(EMPTY_VEC.hash)).toBe(true)
  })

  test("node_destroyed callback when pruned", () => {
    const graph = make_entity_graph()
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

    entity_graph_set_entity_node(graph, entity, n1)
    entity_graph_set_entity_node(graph, entity, graph.root) // triggers prune

    expect(destroyed_node).toBe(n1)
  })
})
