import {describe, expect, test} from "bun:test"
import {define_component} from "./component"
import {make_history_buffer, push_snapshot} from "./history"
import {
  cleanup_transient_entities,
  prune_buffers,
  reconcile_transaction,
} from "./reconciliation"
import {
  apply_transaction,
  TRANSIENT_DOMAIN,
  type Transaction,
} from "./replication"
import {get_component_value, make_world} from "./world"
import {
  add_component,
  advance_tick,
  commit_transaction,
  spawn,
} from "./world_api"

describe("reconciliation", () => {
  const Position = define_component<{x: number; y: number}>()
  const schema = [Position]

  test("reconcile late arriving transaction", () => {
    const world = make_world(1, schema)
    world.history = make_history_buffer(10)
    // Snapshot at start of tick 0
    push_snapshot(world, world.history)

    const entity = spawn(world, [Position({x: 0, y: 0})])
    commit_transaction(world)
    advance_tick(world) // Tick 0 -> 1

    // Simulate local prediction for Ticks 1 and 2
    // Tick 1
    world.input_buffer.set(1, {dx: 1})
    add_component(world, entity, Position({x: 1, y: 0}))
    commit_transaction(world)
    advance_tick(world) // Tick 1 -> 2

    // Tick 2
    world.input_buffer.set(2, {dx: 1})
    add_component(world, entity, Position({x: 2, y: 0}))
    commit_transaction(world)
    advance_tick(world) // Tick 2 -> 3

    expect(world.tick).toBe(3)
    const pos_2 = get_component_value(world, entity, Position)
    if (pos_2) {
      expect(pos_2.x).toBe(2)
    }

    // Now, a late transaction arrives from the server for Tick 1
    // The server says that at Tick 1, the entity was actually at x=10 (e.g. hit a jump pad)
    const server_tx: Transaction = {
      hi: 0,
      seq: 1,
      tick: 1,
      ops: [
        {
          type: "set",
          entity,
          component_id: world.component_registry.get_id(Position),
          data: {x: 10, y: 0},
          version: 1, // Authoritative tick
        },
      ],
    }

    // Tick function used during resimulation
    const tick_fn = (w: typeof world, input: unknown) => {
      const pos = get_component_value(w, entity, Position)
      const dx = (input as {dx: number} | undefined)?.dx ?? 0
      if (pos) {
        add_component(w, entity, Position({x: pos.x + dx, y: pos.y}))
      }
    }

    reconcile_transaction(world, server_tx, tick_fn)

    // After reconciliation:
    // 1. Rollback to Tick 1 state (Position 0,0)
    // 2. Apply Server TX for Tick 1 (Position 10,0)
    // 3. Resimulate Tick 2: Input {dx: 1} -> Position 11,0
    // 4. Tick is now 3
    expect(world.tick).toBe(3)
    const pos_final = get_component_value(world, entity, Position)
    if (pos_final) {
      expect(pos_final.x).toBe(11)
    }
  })

  test("prune buffers", () => {
    const world = make_world(1, schema)
    world.history = make_history_buffer(10)

    // Fill buffers
    for (let i = 0; i < 5; i++) {
      world.input_buffer.set(i, {dx: i})
      world.remote_transactions.set(i, [{hi: 0, seq: i, tick: i, ops: []}])
      advance_tick(world)
    }

    expect(world.input_buffer.size).toBe(5)
    expect(world.remote_transactions.size).toBe(5)
    expect(world.history.snapshots.length).toBe(5)

    // Prune before tick 3
    prune_buffers(world, 3)

    expect(world.input_buffer.size).toBe(2)
    expect(world.input_buffer.has(3)).toBe(true)
    expect(world.input_buffer.has(4)).toBe(true)

    expect(world.remote_transactions.size).toBe(2)
    expect(world.history.snapshots.length).toBe(3)
    expect(world.history.snapshots[0].tick).toBe(3)
  })

  test("cleanup rejected transient entities (ghosts)", () => {
    const world = make_world(1, schema) // Client

    // 1. Predict a spawn at tick 10
    world.tick = 10
    const entity = spawn(world, [Position({x: 0, y: 0})], TRANSIENT_DOMAIN)
    expect(world.transient_registry.size).toBe(1)

    // 2. Advance time
    world.tick = 20

    // 3. Server sends an authoritative update for tick 15
    // Any transient spawned before tick 15 that hasn't been rebound is now a ghost
    cleanup_transient_entities(world, 15)

    // The entity from tick 10 should be despawned
    expect(world.transient_registry.size).toBe(0)
    expect(get_component_value(world, entity, Position)).toBeUndefined()
  })
})
