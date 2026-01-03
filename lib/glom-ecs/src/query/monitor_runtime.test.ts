import { describe, expect, test } from "bun:test"
import { define_component, define_tag } from "../component"
import { ENTITY } from "../entity"
import { make_world } from "../world"
import { setup_all } from "./all_runtime"
import { make_in, make_out } from "./monitor_runtime"
import {
  add_component,
  despawn,
  remove_component,
  spawn,
  world_flush_graph_changes,
  world_flush_deletions,
} from "../world_api"

describe("monitor_runtime", () => {
  const Position = define_component<{ x: number; y: number }>(1)
  const Tag = define_tag(2)

  test("In<Q> catches new matching entities after flush", () => {
    const world = make_world(0)
    const query = { all: [ENTITY, { read: Position }] }
    const monitor = make_in({ in: query })
    setup_all(monitor, world)

    const e = spawn(world, [Position({ x: 10, y: 20 })])

    // Should be empty before flush
    expect(Array.from(monitor)).toHaveLength(0)

    world_flush_graph_changes(world)

    // Should contain entity after flush
    const results = Array.from(monitor)
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual([e, { x: 10, y: 20 }])

    // Should be cleared after manual clear (which systems do automatically)
    monitor.clear()
    world_flush_deletions(world)
    expect(Array.from(monitor)).toHaveLength(0)
  })

  test("Out<Q> catches entities that no longer match", () => {
    const world = make_world(0)
    const query = { all: [ENTITY, { read: Position }] }
    const monitor = make_out({ out: query })
    setup_all(monitor, world)

    const e = spawn(world, [Position({ x: 10, y: 20 })])
    world_flush_graph_changes(world)
    monitor.clear()
    world_flush_deletions(world)

    // Remove component
    remove_component(world, e, Position)

    // Empty before flush
    expect(Array.from(monitor)).toHaveLength(0)

    world_flush_graph_changes(world)

    // Contains entity after flush, and can STILL READ OLD DATA
    const results = Array.from(monitor)
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual([e, { x: 10, y: 20 }])

    monitor.clear()
    expect(Array.from(monitor)).toHaveLength(0)
  })

  test("Out<Q> catches despawned entities", () => {
    const world = make_world(0)
    const query = { all: [ENTITY, { read: Position }] }
    const monitor = make_out({ out: query })
    setup_all(monitor, world)

    const e = spawn(world, [Position({ x: 10, y: 20 })])
    world_flush_graph_changes(world)
    monitor.clear()
    world_flush_deletions(world)

    despawn(world, e)
    world_flush_graph_changes(world)

    const results = Array.from(monitor)
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual([e, { x: 10, y: 20 }])
  })

  test("Transaction Reduction: Spawn then Despawn in same tick is a no-op", () => {
    const world = make_world(0)
    const in_monitor = make_in({ in: { all: [ENTITY] } })
    const out_monitor = make_out({ out: { all: [ENTITY] } })
    setup_all(in_monitor, world)
    setup_all(out_monitor, world)

    const e = spawn(world, [])
    despawn(world, e)

    world_flush_graph_changes(world)

    expect(Array.from(in_monitor)).toHaveLength(0)
    expect(Array.from(out_monitor)).toHaveLength(0)
  })

  test("Transaction Reduction: Add then Remove in same tick is a no-op", () => {
    const world = make_world(0)
    const query = { all: [ENTITY, { has: Tag }] }
    const in_monitor = make_in({ in: query })
    const out_monitor = make_out({ out: query })
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
    const world = make_world(0)
    const A = define_tag(10)
    const B = define_tag(11)
    const C = define_tag(12)

    const monitor_B = make_in({ in: { all: [ENTITY, { has: B }] } })
    setup_all(monitor_B, world)

    const e = spawn(world, [A])
    world_flush_graph_changes(world)
    monitor_B.clear()
    world_flush_deletions(world)

    // Transition A -> B -> C in one tick
    remove_component(world, e, A)
    add_component(world, e, B)
    remove_component(world, e, B)
    add_component(world, e, C)

    world_flush_graph_changes(world)

    // Net result: entity was A, now is C. It entered B and left B.
    // So In<B> should NOT trigger.
    expect(Array.from(monitor_B)).toHaveLength(0)
  })

  test("Out<Q> yields data before deferred deletion clears it", () => {
    const world = make_world(0)
    const monitor = make_out({ out: { all: [{ read: Position }] } })
    setup_all(monitor, world)

    const e = spawn(world, [Position({ x: 1, y: 1 })])
    world_flush_graph_changes(world)
    monitor.clear()
    world_flush_deletions(world)

    despawn(world, e)

    // Data should still be in store during flush, and monitor should get it
    world_flush_graph_changes(world)
    const results = Array.from(monitor)
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual([{ x: 1, y: 1 }])

    // Next tick, data should finally be gone
    world_flush_deletions(world)
    expect(world.index.entity_to_index.dense).toHaveLength(0)
  })
})

