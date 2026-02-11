import {describe, expect, test} from "bun:test"
import * as Component from "../component"
import type {AllDescriptor, JoinDescriptor} from "../descriptors"
import * as Entity from "../entity"
import {type EntityGraphNode, entityGraphSetEntityNode} from "../entity_graph"
import * as Relation from "../relation"
import {getOrCreateIndex} from "../world"
import * as World from "../world"
import {setComponentValue} from "../world"
import {addComponent, spawn} from "../world_api"
import {AllRuntime, makeAll, setupAll, teardownAll} from "./all_runtime"

describe("allRuntime", () => {
  const c1 = Component.define<{val: number}>("c1")
  const c2 = Component.define<{name: string}>("c2")
  const schema = [c1, c2]
  const desc: AllDescriptor = {
    all: [{read: c1}, {write: c2}],
  }

  test("makeAll returns AllRuntime instance", () => {
    const all = makeAll(desc)
    expect(all).toBeInstanceOf(AllRuntime)
  })

  test("setupAll adds listener and populates nodes", () => {
    const world = World.create({domainId: 0})
    const all = makeAll(desc) as AllRuntime

    setupAll(all, world)

    expect(all.nodes.dense.length).toBeGreaterThan(0)
  })

  test("iterator yields component values", () => {
    const world = World.create({domainId: 0})
    const all = makeAll(desc) as AllRuntime
    setupAll(all, world)

    const e1 = Entity.make(1, 0)
    const e2 = Entity.make(2, 0)

    setComponentValue(world, e1, c1, {val: 10})
    setComponentValue(world, e1, c2, {name: "e1"})
    setComponentValue(world, e2, c1, {val: 20})
    setComponentValue(world, e2, c2, {name: "e2"})

    const node = all._anchor_node as EntityGraphNode
    entityGraphSetEntityNode(
      world.graph,
      e1,
      node,
      getOrCreateIndex(world, e1 as unknown as number),
    )
    entityGraphSetEntityNode(
      world.graph,
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
    const world = World.create({domainId: 0})
    const all = makeAll(descWithEntity) as AllRuntime
    setupAll(all, world)

    const e1 = Entity.make(1, 0)
    setComponentValue(world, e1, c1, {val: 10})

    const node = all._anchor_node as EntityGraphNode
    entityGraphSetEntityNode(
      world.graph,
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
      all: [Entity.Entity, {read: c1}],
    }
    const world = World.create({domainId: 0})
    const all = makeAll(descWithEntity) as AllRuntime
    setupAll(all, world)

    const e1 = Entity.make(5, 0)
    setComponentValue(world, e1, c1, {val: 50})

    const node = all._anchor_node as EntityGraphNode
    entityGraphSetEntityNode(
      world.graph,
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
    const t1 = Component.defineTag("t1")
    const descWithTag: AllDescriptor = {
      all: [Entity.Entity, {has: t1}, {read: c1}],
    }
    const world = World.create({domainId: 0})
    const all = makeAll(descWithTag) as AllRuntime
    setupAll(all, world)

    const e1 = Entity.make(7, 0)
    setComponentValue(world, e1, c1, {val: 70})

    const node = all._anchor_node as EntityGraphNode
    entityGraphSetEntityNode(
      world.graph,
      e1,
      node,
      getOrCreateIndex(world, e1 as unknown as number),
    )

    const results = []
    for (const r of all) {
      results.push([...r])
    }
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual([e1, {val: 70}])
  })

  test("iterator with Not filter", () => {
    const c3 = Component.define<{val: number}>("c3")
    const descWithNot: AllDescriptor = {
      all: [{read: c1}, {not: c3}],
    }

    const world = World.create({domainId: 0})
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
    expect(results[0]).toEqual([{val: 10}])
  })

  test("iterator with Join and Not filter", () => {
    const rel = Relation.define("rel")
    const c3 = Component.define<{val: number}>("c3")
    const world = World.create({domainId: 0})

    const descWithJoinNot: JoinDescriptor<any, any, any> = {
      join: [{all: []}, {all: [{not: c3}]}, rel],
    }

    const all = makeAll(descWithJoinNot as any) as AllRuntime
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
    expect(results[0]).toEqual([])
  })

  test("teardownAll removes listener and clears nodes", () => {
    const world = World.create({domainId: 0})
    const all = makeAll(desc) as AllRuntime

    setupAll(all, world)
    expect(all.nodes.dense.length).toBeGreaterThan(0)

    const anchorNode = all._anchor_node as EntityGraphNode
    expect(anchorNode).toBeDefined()

    teardownAll(all)
    expect(all.nodes.dense.length).toBe(0)

    const node = world.graph.byHash.get(anchorNode.vec.hash)
    expect(node?.listeners).not.toContain(all)
  })
})
