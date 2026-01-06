import {describe, expect, test} from "bun:test"
import {define_component} from "./component"
import {HistoryBuffer, push_snapshot, rollback_to_tick} from "./history"
import {resimulate_with_transactions} from "./reconciliation"
import {InputBuffer} from "./replication_config"
import {get_component_value, get_resource, make_world} from "./world"
import {
  add_component,
  add_resource,
  advance_tick,
  commit_transaction,
  despawn,
  spawn,
} from "./world_api"

describe("history", () => {
  const Position = define_component<{x: number; y: number}>()

  test("capture and rollback component data", () => {
    const world = make_world({domain_id: 1, schema: [Position]})
    const history = {snapshots: [], max_size: 10}
    add_resource(world, HistoryBuffer(history))
    push_snapshot(world, history)

    const entity = spawn(world, [Position({x: 0, y: 0})])
    commit_transaction(world)
    advance_tick(world)

    add_component(world, entity, Position({x: 10, y: 10}))
    commit_transaction(world)
    advance_tick(world)

    expect(get_component_value(world, entity, Position)?.x).toBe(10)

    const success = rollback_to_tick(world, HistoryBuffer, 0)
    expect(success).toBe(true)
    expect(world.tick).toBe(0)
    const pos_0 = get_component_value(world, entity, Position)
    if (pos_0) {
      expect(pos_0.x).toBe(0)
    }
  })

  test("rollback entity spawn", () => {
    const world = make_world({domain_id: 1, schema: [Position]})
    const history = {snapshots: [], max_size: 10}
    add_resource(world, HistoryBuffer(history))
    push_snapshot(world, history)

    const entity = spawn(world, [Position({x: 10, y: 10})])
    commit_transaction(world)
    advance_tick(world)

    expect(get_component_value(world, entity, Position)).toBeDefined()

    rollback_to_tick(world, HistoryBuffer, 0)
    expect(world.tick).toBe(0)
    expect(get_component_value(world, entity, Position)).toBeUndefined()
  })

  test("rollback entity despawn", () => {
    const world = make_world({domain_id: 1, schema: [Position]})
    const history = {snapshots: [], max_size: 10}
    add_resource(world, HistoryBuffer(history))

    const entity = spawn(world, [Position({x: 10, y: 10})])
    commit_transaction(world)
    push_snapshot(world, history)

    despawn(world, entity)
    commit_transaction(world)
    advance_tick(world)

    expect(get_component_value(world, entity, Position)).toBeUndefined()

    rollback_to_tick(world, HistoryBuffer, 0)
    expect(world.tick).toBe(0)
    expect(get_component_value(world, entity, Position)).toBeDefined()
    const pos_rolled = get_component_value(world, entity, Position)
    if (pos_rolled) {
      expect(pos_rolled.x).toBe(10)
    }
  })

  test("resimulate forward after rollback", () => {
    const world = make_world({domain_id: 1, schema: [Position]})
    const history = {snapshots: [], max_size: 10}
    add_resource(world, HistoryBuffer(history))
    const input_buffer = new Map<number, unknown>()
    add_resource(world, InputBuffer(input_buffer))

    const entity = spawn(world, [Position({x: 0, y: 0})])
    commit_transaction(world)

    push_snapshot(world, history)

    input_buffer.set(1, {dx: 1, dy: 1})
    add_component(world, entity, Position({x: 1, y: 1}))
    commit_transaction(world)
    advance_tick(world)

    input_buffer.set(2, {dx: 1, dy: 1})
    add_component(world, entity, Position({x: 2, y: 2}))
    commit_transaction(world)
    advance_tick(world)

    expect(get_component_value(world, entity, Position)?.x).toBe(2)

    rollback_to_tick(world, HistoryBuffer, 0)
    expect(world.tick).toBe(0)
    const pos_rolled_resim = get_component_value(world, entity, Position)
    if (pos_rolled_resim) {
      expect(pos_rolled_resim.x).toBe(0)
    }

    resimulate_with_transactions(world, 2, (w, input: unknown) => {
      const pos = get_component_value(w, entity, Position)
      const typed_input = input as {dx: number; dy: number}
      if (pos) {
        add_component(
          w,
          entity,
          Position({x: pos.x + typed_input.dx, y: pos.y + typed_input.dy}),
        )
      }
    })

    expect(world.tick).toBe(2)
    const pos_2 = get_component_value(world, entity, Position)
    if (pos_2) {
      expect(pos_2.x).toBe(2)
    }
  })
})
