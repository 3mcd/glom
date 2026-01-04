import {describe, expect, test} from "bun:test"
import {define_component} from "../component"
import {apply_transaction, type Transaction} from "../replication"
import {Replicated} from "../replication_config"
import {get_component_value, make_world} from "../world"
import {add_component, commit_transaction, despawn, spawn} from "../world_api"

describe("selective replication", () => {
  const Position = define_component<{x: number; y: number}>()
  const schema = [Position]

  test("only record mutations for entities with Replicated tag", () => {
    const world_a = make_world(1, schema)
    const world_b = make_world(2, schema)

    let tx_count = 0
    world_a.recorder = (tx: Transaction) => {
      tx_count++
      apply_transaction(world_b, tx)
    }

    // 1. Spawn without Replicated
    const e1 = spawn(world_a, [Position({x: 0, y: 0})])
    commit_transaction(world_a)
    expect(tx_count).toBe(0)
    expect(get_component_value(world_b, e1, Position)).toBeUndefined()

    // 2. Add Replicated tag later
    add_component(world_a, e1, Replicated)
    commit_transaction(world_a)
    expect(tx_count).toBe(1)
    expect(get_component_value(world_b, e1, Position)).toBeDefined()

    // 3. Mutation after Replicated is added
    add_component(world_a, e1, Position({x: 10, y: 10}))
    commit_transaction(world_a)
    expect(tx_count).toBe(2)
    expect(get_component_value(world_b, e1, Position)?.x).toBe(10)

    // 4. Spawn WITH Replicated
    const e2 = spawn(world_a, [Position({x: 100, y: 100}), Replicated])
    commit_transaction(world_a)
    expect(tx_count).toBe(3)
    expect(get_component_value(world_b, e2, Position)?.x).toBe(100)

    // 5. Despawn replicated
    despawn(world_a, e2)
    commit_transaction(world_a)
    expect(tx_count).toBe(4)
    expect(get_component_value(world_b, e2, Position)).toBeUndefined()
  })
})
