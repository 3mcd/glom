import {describe, expect, test} from "bun:test"
import {define_component} from "../component"
import {apply_transaction, type Transaction} from "../replication"
import {Replicated, ReplicationStream} from "../replication_config"
import {add_resource, get_component_value, get_resource, make_world} from "../world"
import {add_component, commit_transaction, despawn, spawn} from "../world_api"

describe("selective replication", () => {
  const Position = define_component<{x: number; y: number}>()
  const schema = [Position]

  test("only record mutations for entities with Replicated tag", () => {
    const world_a = make_world({domain_id: 1, schema})
    const world_b = make_world({domain_id: 2, schema})
    add_resource(world_a, ReplicationStream({transactions: [], snapshots: []}))

    let total_transaction_count = 0
    function sync() {
      const stream = get_resource(world_a, ReplicationStream)
      if (stream) {
        total_transaction_count += stream.transactions.length
        for (const tx of stream.transactions) {
          apply_transaction(world_b, tx)
        }
        stream.transactions.length = 0
      }
    }

    const e1 = spawn(world_a, [Position({x: 0, y: 0})])
    commit_transaction(world_a)
    sync()
    expect(total_transaction_count).toBe(0)
    expect(get_component_value(world_b, e1, Position)).toBeUndefined()

    add_component(world_a, e1, Replicated)
    commit_transaction(world_a)
    sync()
    expect(total_transaction_count).toBe(1)
    expect(get_component_value(world_b, e1, Position)).toBeDefined()

    add_component(world_a, e1, Position({x: 10, y: 10}))
    commit_transaction(world_a)
    sync()
    expect(total_transaction_count).toBe(2)
    expect(get_component_value(world_b, e1, Position)?.x).toBe(10)

    const e2 = spawn(world_a, [Position({x: 100, y: 100}), Replicated])
    commit_transaction(world_a)
    sync()
    expect(total_transaction_count).toBe(3)
    expect(get_component_value(world_b, e2, Position)?.x).toBe(100)

    despawn(world_a, e2)
    commit_transaction(world_a)
    sync()
    expect(total_transaction_count).toBe(4)
    expect(get_component_value(world_b, e2, Position)).toBeUndefined()
  })
})
