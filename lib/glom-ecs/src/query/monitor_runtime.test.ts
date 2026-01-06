import {describe, expect, test} from "bun:test"
import {defineComponent, defineTag} from "../component"
import {Entity} from "../entity"
import {defineRelation} from "../relation"
import {makeWorld} from "../world"
import {
  addComponent,
  despawn,
  removeComponent,
  spawn,
  flushDeletions,
  flushGraphChanges,
} from "../world_api"
import {setupAll} from "./all_runtime"
import {makeIn, makeOut} from "./monitor_runtime"

describe("monitorRuntime", () => {
  const Position = defineComponent<{x: number; y: number}>()
  const Tag = defineTag()
  const schema = [Position, Tag]

  test("In<Q> catches new matching entities after flush", () => {
    const world = makeWorld({domainId: 0, schema})
    const query = {all: [Entity, {read: Position}]}
    const monitor = makeIn({in: query})
    setupAll(monitor, world)

    const e = spawn(world, Position({x: 10, y: 20}))

    expect(Array.from(monitor)).toHaveLength(0)

    flushGraphChanges(world)

    const results = Array.from(monitor)
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual([e, {x: 10, y: 20}])

    monitor.clear()
    flushDeletions(world)
    expect(Array.from(monitor)).toHaveLength(0)
  })

  test("Out<Q> catches entities that no longer match", () => {
    const world = makeWorld({domainId: 0, schema})
    const query = {all: [Entity, {read: Position}]}
    const monitor = makeOut({out: query})
    setupAll(monitor, world)

    const e = spawn(world, Position({x: 10, y: 20}))
    flushGraphChanges(world)
    monitor.clear()
    flushDeletions(world)

    removeComponent(world, e, Position)

    expect(Array.from(monitor)).toHaveLength(0)

    flushGraphChanges(world)

    const results = Array.from(monitor)
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual([e, {x: 10, y: 20}])

    monitor.clear()
    expect(Array.from(monitor)).toHaveLength(0)
  })

  test("Out<Q> catches despawned entities", () => {
    const world = makeWorld({domainId: 0, schema})
    const query = {all: [Entity, {read: Position}]}
    const monitor = makeOut({out: query})
    setupAll(monitor, world)

    const e = spawn(world, Position({x: 10, y: 20}))
    flushGraphChanges(world)
    monitor.clear()
    flushDeletions(world)

    despawn(world, e)
    flushGraphChanges(world)

    const results = Array.from(monitor)
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual([e, {x: 10, y: 20}])
  })

  test("Transaction Reduction: Spawn then Despawn in same tick is a no-op", () => {
    const world = makeWorld({domainId: 0, schema})
    const inMonitor = makeIn({in: {all: [Entity]}})
    const outMonitor = makeOut({out: {all: [Entity]}})
    setupAll(inMonitor, world)
    setupAll(outMonitor, world)

    const e = spawn(world)
    despawn(world, e)

    flushGraphChanges(world)

    expect(Array.from(inMonitor)).toHaveLength(0)
    expect(Array.from(outMonitor)).toHaveLength(0)
  })

  test("Transaction Reduction: Add then Remove in same tick is a no-op", () => {
    const world = makeWorld({domainId: 0, schema})
    const query = {all: [Entity, {has: Tag}]}
    const inMonitor = makeIn({in: query})
    const outMonitor = makeOut({out: query})
    setupAll(inMonitor, world)
    setupAll(outMonitor, world)

    const e = spawn(world)
    flushGraphChanges(world)
    inMonitor.clear()
    outMonitor.clear()
    flushDeletions(world)

    addComponent(world, e, Tag)
    removeComponent(world, e, Tag)

    flushGraphChanges(world)

    expect(Array.from(inMonitor)).toHaveLength(0)
    expect(Array.from(outMonitor)).toHaveLength(0)
  })

  test("Multi-step transition: A -> B -> C only triggers In if net move is In", () => {
    const A = defineTag()
    const B = defineTag()
    const C = defineTag()
    const world = makeWorld({domainId: 0, schema: [A, B, C]})

    const monitor_B = makeIn({in: {all: [Entity, {has: B}]}})
    setupAll(monitor_B, world)

    const e = spawn(world, A)
    flushGraphChanges(world)
    monitor_B.clear()
    flushDeletions(world)

    removeComponent(world, e, A)
    addComponent(world, e, B)
    removeComponent(world, e, B)
    addComponent(world, e, C)

    flushGraphChanges(world)

    expect(Array.from(monitor_B)).toHaveLength(0)
  })

  test("Out<Q> yields data before deferred deletion clears it", () => {
    const world = makeWorld({domainId: 0, schema})
    const monitor = makeOut({out: {all: [{read: Position}]}})
    setupAll(monitor, world)

    const e = spawn(world, Position({x: 1, y: 1}))
    flushGraphChanges(world)
    monitor.clear()
    flushDeletions(world)

    despawn(world, e)

    flushGraphChanges(world)
    const results = Array.from(monitor)
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual([{x: 1, y: 1}])

    flushDeletions(world)
    expect(world.index.entityToIndex.dense).toHaveLength(0)
  })

  test("Out fires when the related entity has a tag removed", () => {
    const Attacking = defineTag()
    const EmitsFrom = defineRelation()
    const world = makeWorld({
      domainId: 0,
      schema: [Attacking, EmitsFrom, Position],
    })

    // 1. Create a player that is Attacking
    const player = spawn(world, Attacking, Position({x: 10, y: 10}))

    // 2. Create a beam that EmitsFrom the player
    const beam = spawn(world, Position({x: 1, y: 1}), EmitsFrom(player))

    // 3. Define the query: Entity that EmitsFrom an entity that Has Attacking
    const query = {
      join: [
        {all: [Entity]},
        {all: [{has: Attacking}]},
        EmitsFrom,
      ],
    }

    const monitor = makeOut({out: query as any})
    setupAll(monitor, world)

    // Initial state: beam matches, so it shouldn't be in Out monitor yet
    flushGraphChanges(world)
    expect(Array.from(monitor)).toHaveLength(0)

    // 4. Remove Attacking from player
    removeComponent(world, player, Attacking)

    // 5. Flush changes
    flushGraphChanges(world)

    // 6. Verify that the beam is now in the Out monitor
    const results = Array.from(monitor)
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual([beam, undefined])

    monitor.clear()
    flushDeletions(world)
    expect(Array.from(monitor)).toHaveLength(0)
  })

  test("Out<Has<Tag>> should fire when Tag is removed", () => {
    const world = makeWorld({domainId: 0, schema})
    const query = {all: [Entity, {has: Tag}]}
    const monitor = makeOut({out: query})
    setupAll(monitor, world)

    const e = spawn(world, Tag)
    flushGraphChanges(world)
    monitor.clear()

    removeComponent(world, e, Tag)
    flushGraphChanges(world)

    const results = Array.from(monitor)
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual([e, undefined])
  })
})
