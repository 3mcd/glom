import {describe, expect, test} from "bun:test"
import {define_component} from "../component"
import {HistoryBuffer, make_history_buffer, push_snapshot} from "../history"
import {
  cleanup_transient_entities,
  prune_buffers,
  reconcile_transaction,
} from "../reconciliation"
import {
  apply_transaction,
  TRANSIENT_DOMAIN,
  type Transaction,
} from "../replication"
import {
  IncomingSnapshots,
  IncomingTransactions,
  InputBuffer,
} from "../replication_config"
import {get_component_value, make_world} from "../world"
import {
  add_component,
  add_resource,
  advance_tick,
  commit_transaction,
  spawn,
} from "../world_api"

describe("reconciliation", () => {
  const Position = define_component<{x: number; y: number}>()

  test("reconcile late arriving transaction", () => {
    const world = make_world({domain_id: 1, schema: [Position]})
    const history = {snapshots: [], max_size: 10}
    add_resource(world, HistoryBuffer(history))
    const input_buffer = new Map<number, unknown>()
    add_resource(world, InputBuffer(input_buffer))
    add_resource(world, IncomingTransactions(new Map()))

    push_snapshot(world, history)

    const entity = spawn(world, [Position({x: 0, y: 0})])
    commit_transaction(world)
    advance_tick(world)

    input_buffer.set(1, {dx: 1})
    add_component(world, entity, Position({x: 1, y: 0}))
    commit_transaction(world)
    advance_tick(world)

    input_buffer.set(2, {dx: 1})
    add_component(world, entity, Position({x: 2, y: 0}))
    commit_transaction(world)
    advance_tick(world)

    expect(world.tick).toBe(3)
    const pos_2 = get_component_value(world, entity, Position)
    if (pos_2) {
      expect(pos_2.x).toBe(2)
    }

    const server_transaction: Transaction = {
      domain_id: 0,
      seq: 1,
      tick: 1,
      ops: [
        {
          type: "set",
          entity,
          component_id: world.component_registry.get_id(Position),
          data: {x: 10, y: 0},
          version: 1,
        },
      ],
    }

    const tick_fn = (w: typeof world, input: any) => {
      const pos = get_component_value(w, entity, Position)
      const move = input as {dx: number} | undefined
      if (move && pos) {
        add_component(w, entity, Position({x: pos.x + move.dx, y: pos.y}))
      }
    }

    reconcile_transaction(world, server_transaction, tick_fn)

    expect(world.tick).toBe(3)
    const pos_final = get_component_value(world, entity, Position)
    if (pos_final) {
      expect(pos_final.x).toBe(11)
    }
  })

  test("prune buffers", () => {
    const world = make_world({domain_id: 1, schema: [Position]})
    const history = {snapshots: [], max_size: 10}
    add_resource(world, HistoryBuffer(history))
    const input_buffer = new Map<number, unknown>()
    add_resource(world, InputBuffer(input_buffer))
    const incoming_transactions = new Map<number, Transaction[]>()
    add_resource(world, IncomingTransactions(incoming_transactions))
    add_resource(world, IncomingSnapshots(new Map()))

    for (let i = 0; i < 5; i++) {
      input_buffer.set(i, {dx: i})
      incoming_transactions.set(i, [{domain_id: 0, seq: i, tick: i, ops: []}])
      advance_tick(world)
    }

    expect(input_buffer.size).toBe(5)
    expect(incoming_transactions.size).toBe(5)
    expect(history.snapshots.length).toBe(5)

    prune_buffers(world, 3)

    expect(input_buffer.size).toBe(2)
    expect(input_buffer.has(3)).toBe(true)
    expect(input_buffer.has(4)).toBe(true)

    expect(incoming_transactions.size).toBe(2)
    expect(history.snapshots.length).toBe(3)
    if (history.snapshots.length > 0 && history.snapshots[0]) {
      expect(history.snapshots[0].tick).toBe(3)
    }
  })

  test("cleanup rejected transient entities (ghosts)", () => {
    const world = make_world({domain_id: 1, schema: [Position]})

    world.tick = 10
    const entity = spawn(world, [Position({x: 0, y: 0})], TRANSIENT_DOMAIN)
    expect(world.transient_registry.size).toBe(1)

    world.tick = 20

    cleanup_transient_entities(world, 15)

    expect(world.transient_registry.size).toBe(0)
    expect(get_component_value(world, entity, Position)).toBeUndefined()
  })
})
