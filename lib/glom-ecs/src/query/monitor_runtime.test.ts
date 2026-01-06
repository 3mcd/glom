import {describe, expect, test} from "bun:test"
import {define_component, define_tag} from "../component"
import {Entity} from "../entity"
import {make_world} from "../world"
import {
  add_component,
  despawn,
  remove_component,
  spawn,
  world_flush_deletions,
  world_flush_graph_changes,
} from "../world_api"
import {setup_all} from "./all_runtime"
import {make_in, make_out} from "./monitor_runtime"

describe("monitor_runtime", () => {
  const Position = define_component<{x: number; y: number}>()
  const Tag = define_tag()
  const schema = [Position, Tag]

  test("In<Q> catches new matching entities after flush", () => {
    const world = make_world({domain_id: 0, schema})
    const query = {all: [Entity, {read: Position}]}
    const monitor = make_in({in: query})
    setup_all(monitor, world)

    const e = spawn(world, [Position({x: 10, y: 20})])

    expect(Array.from(monitor)).toHaveLength(0)

    world_flush_graph_changes(world)

    const results = Array.from(monitor)
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual([e, {x: 10, y: 20}])

    monitor.clear()
    world_flush_deletions(world)
    expect(Array.from(monitor)).toHaveLength(0)
  })

  test("Out<Q> catches entities that no longer match", () => {
    const world = make_world({domain_id: 0, schema})
    const query = {all: [Entity, {read: Position}]}
    const monitor = make_out({out: query})
    setup_all(monitor, world)

    const e = spawn(world, [Position({x: 10, y: 20})])
    world_flush_graph_changes(world)
    monitor.clear()
    world_flush_deletions(world)

    remove_component(world, e, Position)

    expect(Array.from(monitor)).toHaveLength(0)

    world_flush_graph_changes(world)

    const results = Array.from(monitor)
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual([e, {x: 10, y: 20}])

    monitor.clear()
    expect(Array.from(monitor)).toHaveLength(0)
  })

  test("Out<Q> catches despawned entities", () => {
    const world = make_world({domain_id: 0, schema})
    const query = {all: [Entity, {read: Position}]}
    const monitor = make_out({out: query})
    setup_all(monitor, world)

    const e = spawn(world, [Position({x: 10, y: 20})])
    world_flush_graph_changes(world)
    monitor.clear()
    world_flush_deletions(world)

    despawn(world, e)
    world_flush_graph_changes(world)

    const results = Array.from(monitor)
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual([e, {x: 10, y: 20}])
  })

  test("Transaction Reduction: Spawn then Despawn in same tick is a no-op", () => {
    const world = make_world({domain_id: 0, schema})
    const in_monitor = make_in({in: {all: [Entity]}})
    const out_monitor = make_out({out: {all: [Entity]}})
    setup_all(in_monitor, world)
    setup_all(out_monitor, world)

    const e = spawn(world, [])
    despawn(world, e)

    world_flush_graph_changes(world)

    expect(Array.from(in_monitor)).toHaveLength(0)
    expect(Array.from(out_monitor)).toHaveLength(0)
  })

  test("Transaction Reduction: Add then Remove in same tick is a no-op", () => {
    const world = make_world({domain_id: 0, schema})
    const query = {all: [Entity, {has: Tag}]}
    const in_monitor = make_in({in: query})
    const out_monitor = make_out({out: query})
    setup_all(in_monitor, world)
    setup_all(out_monitor, world)

    const e = spawn(world, [])
    world_flush_graph_changes(world)
    in_monitor.clear()
    out_monitor.clear()
    world_flush_deletions(world)

    add_component(world, e, Tag)
    remove_component(world, e, Tag)

    world_flush_graph_changes(world)

    expect(Array.from(in_monitor)).toHaveLength(0)
    expect(Array.from(out_monitor)).toHaveLength(0)
  })

  test("Multi-step transition: A -> B -> C only triggers In if net move is In", () => {
    const A = define_tag()
    const B = define_tag()
    const C = define_tag()
    const world = make_world({domain_id: 0, schema: [A, B, C]})

    const monitor_B = make_in({in: {all: [Entity, {has: B}]}})
    setup_all(monitor_B, world)

    const e = spawn(world, [A])
    world_flush_graph_changes(world)
    monitor_B.clear()
    world_flush_deletions(world)

    remove_component(world, e, A)
    add_component(world, e, B)
    remove_component(world, e, B)
    add_component(world, e, C)

    world_flush_graph_changes(world)

    expect(Array.from(monitor_B)).toHaveLength(0)
  })

  test("Out<Q> yields data before deferred deletion clears it", () => {
    const world = make_world({domain_id: 0, schema})
    const monitor = make_out({out: {all: [{read: Position}]}})
    setup_all(monitor, world)

    const e = spawn(world, [Position({x: 1, y: 1})])
    world_flush_graph_changes(world)
    monitor.clear()
    world_flush_deletions(world)

    despawn(world, e)

    world_flush_graph_changes(world)
    const results = Array.from(monitor)
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual([{x: 1, y: 1}])

    world_flush_deletions(world)
    expect(world.index.entity_to_index.dense).toHaveLength(0)
  })
})
