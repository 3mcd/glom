import { describe, expect, test } from "bun:test"
import { define_component, define_tag } from "../component"
import { ENTITY, make_entity } from "../entity"
import {
  entity_graph_set_entity_node,
} from "../entity_graph"
import type { AllDescriptor } from "../system_descriptor"
import { make_world, set_component_value } from "../world"
import { AllRuntime, make_all, setup_all, teardown_all } from "./all_runtime"

describe("all_runtime", () => {
  const c1 = define_component<{ val: number }>(1)
  const c2 = define_component<{ name: string }>(2)
  const desc: AllDescriptor<unknown, unknown> = {
    all: [{ read: c1 }, { write: c2 }],
  } as unknown as AllDescriptor<unknown, unknown>

  test("make_all returns AllRuntime instance", () => {
    const all = make_all(desc)
    expect(all).toBeInstanceOf(AllRuntime)
  })

  test("setup_all adds listener and populates nodes", () => {
    const world = make_world(0)
    const all = make_all(desc) as AllRuntime

    setup_all(all, world)

    // The anchor node itself should be in the nodes map because of the emit_existing_nodes flag
    expect(all.nodes.dense.length).toBeGreaterThan(0)
  })

  test("iterator yields component values", () => {
    const world = make_world(0)
    const all = make_all(desc) as AllRuntime
    setup_all(all, world)

    const e1 = make_entity(1, 0)
    const e2 = make_entity(2, 0)

    set_component_value(world, e1, c1, { val: 10 })
    set_component_value(world, e1, c2, { name: "e1" })
    set_component_value(world, e2, c1, { val: 20 })
    set_component_value(world, e2, c2, { name: "e2" })

    // Manually put entities into the node
    // @ts-ignore: private access for test
    const node = all._anchor_node
    entity_graph_set_entity_node(world.entity_graph, e1, node)
    entity_graph_set_entity_node(world.entity_graph, e2, node)

    const results = Array.from(all) as [{ val: number }, { name: string }][]
    expect(results).toHaveLength(2)

    // Results might be in any order because of sparse set / graph nodes
    const sortedResults = results.sort((a, b) => a[0].val - b[0].val)

    expect(sortedResults[0]).toEqual([{ val: 10 }, { name: "e1" }])
    expect(sortedResults[1]).toEqual([{ val: 20 }, { name: "e2" }])
  })

  test("iterator yields entity IDs", () => {
    const descWithEntity: AllDescriptor<unknown, unknown> = {
      all: [{ entity: true }, { read: c1 }],
    } as unknown as AllDescriptor<unknown, unknown>
    const world = make_world(0)
    const all = make_all(descWithEntity) as AllRuntime
    setup_all(all, world)

    const e1 = make_entity(1, 0)
    set_component_value(world, e1, c1, { val: 10 })

    // @ts-ignore: private access for test
    const node = all._anchor_node
    entity_graph_set_entity_node(world.entity_graph, e1, node)

    const results = Array.from(all)
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual([e1, { val: 10 }])
  })

  test("iterator with ENTITY constant", () => {
    const descWithEntity: AllDescriptor<unknown, unknown> = {
      all: [ENTITY, { read: c1 }],
    } as unknown as AllDescriptor<unknown, unknown>
    const world = make_world(0)
    const all = make_all(descWithEntity) as AllRuntime
    setup_all(all, world)

    const e1 = make_entity(5, 0)
    set_component_value(world, e1, c1, { val: 50 })

    // @ts-ignore: private access for test
    const node = all._anchor_node
    entity_graph_set_entity_node(world.entity_graph, e1, node)

    const results = Array.from(all)
    expect(results[0]).toEqual([e1, { val: 50 }])
  })

  test("iterator with tags (ZSTs)", () => {
    const t1 = define_tag(10)
    const descWithTag: AllDescriptor<unknown, unknown, unknown> = {
      all: [ENTITY, { has: t1 }, { read: c1 }],
    } as unknown as AllDescriptor<unknown, unknown, unknown>
    const world = make_world(0)
    const all = make_all(descWithTag) as AllRuntime
    setup_all(all, world)

    const e1 = make_entity(7, 0)
    set_component_value(world, e1, c1, { val: 70 })

    // @ts-ignore: private access for test
    const node = all._anchor_node
    entity_graph_set_entity_node(world.entity_graph, e1, node)

    const results = Array.from(all)
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual([e1, undefined, { val: 70 }])
  })

  test("teardown_all removes listener and clears nodes", () => {
    const world = make_world(0)
    const all = make_all(desc) as AllRuntime

    setup_all(all, world)
    expect(all.nodes.dense.length).toBeGreaterThan(0)

    // Check that it's actually removed from the graph
    // @ts-ignore: private access for test
    const anchorNode = all._anchor_node
    expect(anchorNode).toBeDefined()

    teardown_all(all)
    expect(all.nodes.dense.length).toBe(0)

    const node = world.entity_graph.by_hash.get(anchorNode.vec.hash)
    expect(node?.listeners).not.toContain(all)
  })
})
