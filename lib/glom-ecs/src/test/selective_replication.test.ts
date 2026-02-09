import {describe, expect, test} from "bun:test"
import {defineComponent} from "../component"
import {applyTransaction} from "../replication"
import {Replicated, ReplicationStream} from "../replication_config"
import {addResource, getComponentValue, getResource, makeWorld} from "../world"
import {addComponent, commitTransaction, despawn, spawn} from "../world_api"

describe("selective replication", () => {
  const Position = defineComponent<{x: number; y: number}>()
  const schema = [Position]

  test("only record mutations for entities with Replicated tag", () => {
    const worldA = makeWorld({domainId: 1, schema})
    const worldB = makeWorld({domainId: 2, schema})
    addResource(worldA, ReplicationStream({transactions: [], snapshots: []}))

    let totalTransactionCount = 0
    function sync() {
      const stream = getResource(worldA, ReplicationStream)
      if (stream) {
        totalTransactionCount += stream.transactions.length
        for (const tx of stream.transactions) {
          applyTransaction(worldB, tx)
        }
        stream.transactions.length = 0
      }
    }

    const e1 = spawn(worldA, Position({x: 0, y: 0}))
    commitTransaction(worldA)
    sync()
    expect(totalTransactionCount).toBe(0)
    expect(getComponentValue(worldB, e1, Position)).toBeUndefined()

    addComponent(worldA, e1, Replicated)
    commitTransaction(worldA)
    sync()
    expect(totalTransactionCount).toBe(1)
    expect(getComponentValue(worldB, e1, Position)).toBeDefined()

    // Value-only changes no longer emit transactions (values go via snapshots)
    addComponent(worldA, e1, Position({x: 10, y: 10}))
    commitTransaction(worldA)
    sync()
    expect(totalTransactionCount).toBe(1) // no transaction for value change

    const e2 = spawn(worldA, Position({x: 100, y: 100}), Replicated)
    commitTransaction(worldA)
    sync()
    expect(totalTransactionCount).toBe(2)
    expect(getComponentValue(worldB, e2, Position)?.x).toBe(100)

    despawn(worldA, e2)
    commitTransaction(worldA)
    sync()
    expect(totalTransactionCount).toBe(3)
    expect(getComponentValue(worldB, e2, Position)).toBeUndefined()
  })
})
