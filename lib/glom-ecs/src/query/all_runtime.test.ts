import {describe, expect, test} from "bun:test"
import {defineComponent, defineTag} from "../component"
import type {AllDescriptor} from "../descriptors"
import {Entity, makeEntity} from "../entity"
import {type EntityGraphNode, entityGraphSetEntityNode} from "../entity_graph"
import {defineRelation} from "../relation"
import {makeWorld, setComponentValue, getOrCreateIndex} from "../world"
import {addComponent, spawn} from "../world_api"
import {AllRuntime, makeAll, setupAll, teardownAll} from "./all_runtime"

describe("allRuntime", () => {
  const c1 = defineComponent<{val: number}>()
  const c2 = defineComponent<{name: string}>()
  const schema = [c1, c2]
  const desc: AllDescriptor = {
    all: [{read: c1}, {write: c2}],
  }

  test("makeAll returns AllRuntime instance", () => {
    const all = makeAll(desc)
    expect(all).toBeInstanceOf(AllRuntime)
  })

  test("setupAll adds listener and populates nodes", () => {
    const world = makeWorld({domainId: 0, schema})
    const all = makeAll(desc) as AllRuntime

    setupAll(all, world)

    expect(all.nodes.dense.length).toBeGreaterThan(0)
  })

  test("iterator yields component values", () => {
    const world = makeWorld({domainId: 0, schema})
    const all = makeAll(desc) as AllRuntime
    setupAll(all, world)

    const e1 = makeEntity(1, 0)
    const e2 = makeEntity(2, 0)

    setComponentValue(world, e1, c1, {val: 10})
    setComponentValue(world, e1, c2, {name: "e1"})
    setComponentValue(world, e2, c1, {val: 20})
    setComponentValue(world, e2, c2, {name: "e2"})

    const node = all._anchor_node as EntityGraphNode
    entityGraphSetEntityNode(
      world.entityGraph,
      e1,
      node,
      getOrCreateIndex(world, e1 as unknown as number),
    )
    entityGraphSetEntityNode(
      world.entityGraph,
      e2,
      node,
      getOrCreateIndex(world, e2 as unknown as number),
    )

    const results = []
    for (const r of all) {
      results.push([...r])
    }
    expect(results).toHaveLength(2)

    const sortedResults = (results as [{val: number}, {name: string}][]).sort(
      (a, b) => a[0].val - b[0].val,
    )

    expect(sortedResults[0]).toEqual([{val: 10}, {name: "e1"}])
    expect(sortedResults[1]).toEqual([{val: 20}, {name: "e2"}])
  })

  test("iterator yields entity IDs", () => {
    const descWithEntity: AllDescriptor = {
      all: [{entity: true}, {read: c1}],
    }
    const world = makeWorld({domainId: 0, schema})
    const all = makeAll(descWithEntity) as AllRuntime
    setupAll(all, world)

    const e1 = makeEntity(1, 0)
    setComponentValue(world, e1, c1, {val: 10})

    const node = all._anchor_node as EntityGraphNode
    entityGraphSetEntityNode(
      world.entityGraph,
      e1,
      node,
      getOrCreateIndex(world, e1 as unknown as number),
    )

    const results = []
    for (const r of all) {
      results.push([...r])
    }
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual([e1, {val: 10}])
  })

  test("iterator with Entity constant", () => {
    const descWithEntity: AllDescriptor = {
      all: [Entity, {read: c1}],
    }
    const world = makeWorld({domainId: 0, schema})
    const all = makeAll(descWithEntity) as AllRuntime
    setupAll(all, world)

    const e1 = makeEntity(5, 0)
    setComponentValue(world, e1, c1, {val: 50})

    const node = all._anchor_node as EntityGraphNode
    entityGraphSetEntityNode(
      world.entityGraph,
      e1,
      node,
      getOrCreateIndex(world, e1 as unknown as number),
    )

    const results = []
    for (const r of all) {
      results.push([...r])
    }
    expect(results[0]).toEqual([e1, {val: 50}])
  })

  test("iterator with tags (ZSTs)", () => {
    const t1 = defineTag()
    const descWithTag: AllDescriptor = {
      all: [Entity, {has: t1}, {read: c1}],
    }
    const world = makeWorld({domainId: 0, schema: [c1, t1]})
    const all = makeAll(descWithTag) as AllRuntime
    setupAll(all, world)

    const e1 = makeEntity(7, 0)
    setComponentValue(world, e1, c1, {val: 70})

    const node = all._anchor_node as EntityGraphNode
    entityGraphSetEntityNode(
      world.entityGraph,
      e1,
      node,
      getOrCreateIndex(world, e1 as unknown as number),
    )

    const results = []
    for (const r of all) {
      results.push([...r])
    }
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual([e1, undefined, {val: 70}])
  })

  test("iterator with Not filter", () => {
    const c3 = defineComponent<{val: number}>()
    const descWithNot: AllDescriptor = {
      all: [{read: c1}, {not: c3}],
    }

    const world = makeWorld({domainId: 0, schema: [c1, c3]})
    const all = makeAll(descWithNot) as AllRuntime
    setupAll(all, world)

    spawn(world, {component: c1, value: {val: 10}})
    spawn(
      world,
      {component: c1, value: {val: 20}},
      {component: c3, value: {val: 30}},
    )

    const results = []
    for (const r of all) {
      results.push([...r])
    }
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual([{val: 10}, undefined])
  })

  test("iterator with Join and Not filter", () => {
    const rel = defineRelation()
    const c3 = defineComponent<{val: number}>()
    const world = makeWorld({domainId: 0, schema: [rel, c3]})

    const descWithJoinNot: JoinDescriptor = {
      join: [{all: []}, {all: [{not: c3}]}, rel],
    }

    const all = makeAll(descWithJoinNot) as AllRuntime
    setupAll(all, world)

    const obj1 = spawn(world)
    const obj2 = spawn(world, {component: c3, value: {val: 30}})

    const sub1 = spawn(world)
    const sub2 = spawn(world)

    addComponent(world, sub1, rel(obj1))
    addComponent(world, sub2, rel(obj2))

    const results = []
    for (const r of all) {
      results.push([...r])
    }

    expect(results).toHaveLength(1)
    expect(results[0]).toEqual([undefined])
  })

  test("teardownAll removes listener and clears nodes", () => {
    const world = makeWorld({domainId: 0, schema})
    const all = makeAll(desc) as AllRuntime

    setupAll(all, world)
    expect(all.nodes.dense.length).toBeGreaterThan(0)

    const anchorNode = all._anchor_node as EntityGraphNode
    expect(anchorNode).toBeDefined()

    teardownAll(all)
    expect(all.nodes.dense.length).toBe(0)

    const node = world.entityGraph.byHash.get(anchorNode.vec.hash)
    expect(node?.listeners).not.toContain(all)
  })
})
