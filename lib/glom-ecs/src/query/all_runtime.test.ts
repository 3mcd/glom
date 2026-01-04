import { describe, expect, test } from "bun:test"
import { define_component, define_tag } from "../component"
import { Entity, make_entity } from "../entity"
import { entity_graph_set_entity_node } from "../entity_graph"
import type { AllDescriptor } from "../system_descriptor"
import { make_world, set_component_value } from "../world"
import { spawn } from "../world_api"
import { AllRuntime, make_all, setup_all, teardown_all } from "./all_runtime"

describe("all_runtime", () => {
  const c1 = define_component<{ val: number }>()
  const c2 = define_component<{ name: string }>()
  const schema = [c1, c2]
  const desc: AllDescriptor<unknown, unknown> = {
    all: [{ read: c1 }, { write: c2 }],
  } as unknown as AllDescriptor<unknown, unknown>

  test("make_all returns AllRuntime instance", () => {
    const all = make_all(desc)
    expect(all).toBeInstanceOf(AllRuntime)
  })

  test("setup_all adds listener and populates nodes", () => {
    const world = make_world(0, schema)
    const all = make_all(desc) as AllRuntime

    setup_all(all, world)

    // The anchor node itself should be in the nodes map because of the emit_existing_nodes flag
    expect(all.nodes.dense.length).toBeGreaterThan(0)
  })

  test("iterator yields component values", () => {
    const world = make_world(0, schema)
    const all = make_all(desc) as AllRuntime
    setup_all(all, world)

    const e1 = make_entity(1, 0)
    const e2 = make_entity(2, 0)

    set_component_value(world, e1, c1, { val: 10 })
    set_component_value(world, e1, c2, { name: "e1" })
    set_component_value(world, e2, c1, { val: 20 })
    set_component_value(world, e2, c2, { name: "e2" })

    // Manually put entities into the node
    // @ts-expect-error: private access for test
    const node = all._anchor_node
    entity_graph_set_entity_node(world.entity_graph, e1, node)
    entity_graph_set_entity_node(world.entity_graph, e2, node)

    const results = []
    for (const r of all) {
      results.push([...r])
    }
    expect(results).toHaveLength(2)

    // Results might be in any order because of sparse set / graph nodes
    const sortedResults = (
      results as [{ val: number }, { name: string }][]
    ).sort((a, b) => a[0].val - b[0].val)

    expect(sortedResults[0]).toEqual([{ val: 10 }, { name: "e1" }])
    expect(sortedResults[1]).toEqual([{ val: 20 }, { name: "e2" }])
  })

  test("iterator yields entity IDs", () => {
    const descWithEntity: AllDescriptor<unknown, unknown> = {
      all: [{ entity: true }, { read: c1 }],
    } as unknown as AllDescriptor<unknown, unknown>
    const world = make_world(0, schema)
    const all = make_all(descWithEntity) as AllRuntime
    setup_all(all, world)

    const e1 = make_entity(1, 0)
    set_component_value(world, e1, c1, { val: 10 })

    // @ts-expect-error: private access for test
    const node = all._anchor_node
    entity_graph_set_entity_node(world.entity_graph, e1, node)

    const results = []
    for (const r of all) {
      results.push([...r])
    }
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual([e1, { val: 10 }])
  })

  test("iterator with Entity constant", () => {
    const descWithEntity: AllDescriptor<unknown, unknown> = {
      all: [Entity, { read: c1 }],
    } as unknown as AllDescriptor<unknown, unknown>
    const world = make_world(0, schema)
    const all = make_all(descWithEntity) as AllRuntime
    setup_all(all, world)

    const e1 = make_entity(5, 0)
    set_component_value(world, e1, c1, { val: 50 })

    // @ts-expect-error: private access for test
    const node = all._anchor_node
    entity_graph_set_entity_node(world.entity_graph, e1, node)

    const results = []
    for (const r of all) {
      results.push([...r])
    }
    expect(results[0]).toEqual([e1, { val: 50 }])
  })

  test("iterator with tags (ZSTs)", () => {
    const t1 = define_tag()
    const descWithTag: AllDescriptor<unknown, unknown, unknown> = {
      all: [Entity, { has: t1 }, { read: c1 }],
    } as unknown as AllDescriptor<unknown, unknown, unknown>
    const world = make_world(0, [c1, t1])
    const all = make_all(descWithTag) as AllRuntime
    setup_all(all, world)

    const e1 = make_entity(7, 0)
    set_component_value(world, e1, c1, { val: 70 })

    // @ts-expect-error: private access for test
    const node = all._anchor_node
    entity_graph_set_entity_node(world.entity_graph, e1, node)

    const results = []
    for (const r of all) {
      results.push([...r])
    }
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual([e1, undefined, { val: 70 }])
  })

  test("iterator with Not filter", () => {
    const c3 = define_component<{ val: number }>()
    const descWithNot: AllDescriptor<unknown, unknown> = {
      all: [{ read: c1 }, { not: c3 }],
    } as unknown as AllDescriptor<unknown, unknown>

    const world = make_world(0, [c1, c3])
    const all = make_all(descWithNot) as AllRuntime
    setup_all(all, world)

    spawn(world, [{ component: c1, value: { val: 10 } }]) // Has c1, no c3
    spawn(world, [
      { component: c1, value: { val: 20 } },
      { component: c3, value: { val: 30 } },
    ]) // Has c1 and c3

    const results = []
    for (const r of all) {
      results.push([...r])
    }
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual([{ val: 10 }, undefined])
  })

  test("iterator with Rel and Not filter", () => {
    const rel = define_tag()
    const c3 = define_component<{ val: number }>()
    const world = make_world(0, [rel, c3])

    // Rel(rel, Not(c3))
    const descWithRelNot: AllDescriptor<unknown> = {
      all: [{ rel: [rel, { not: c3 }] }],
    } as unknown as AllDescriptor<unknown>

    const all = make_all(descWithRelNot) as AllRuntime
    setup_all(all, world)

    const obj1 = spawn(world, []) // No c3
    const obj2 = spawn(world, [{ component: c3, value: { val: 30 } }])

    // e1 -> obj1 (rel)
    // e1 -> obj2 (rel)
    spawn(world, [
      { relation: rel, object: obj1 },
      { relation: rel, object: obj2 },
    ])

    const results = []
    for (const r of all) {
      results.push([...r])
    }
    // results should be [ [undefined] ] for obj1 only
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual([undefined])
  })

  test("teardown_all removes listener and clears nodes", () => {
    const world = make_world(0, schema)
    const all = make_all(desc) as AllRuntime

    setup_all(all, world)
    expect(all.nodes.dense.length).toBeGreaterThan(0)

    // Check that it's actually removed from the graph
    // @ts-expect-error: private access for test
    const anchorNode = all._anchor_node
    expect(anchorNode).toBeDefined()

    teardown_all(all)
    expect(all.nodes.dense.length).toBe(0)

    const node = world.entity_graph.by_hash.get(anchorNode.vec.hash)
    expect(node?.listeners).not.toContain(all)
  })
})
