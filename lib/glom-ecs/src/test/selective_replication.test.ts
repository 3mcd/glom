import {describe, expect, test} from "bun:test"
import * as Component from "../component"
import {applyTransaction} from "../replication"
import {Replicated, ReplicationStream} from "../replication_config"
import * as World from "../world"
import * as WorldApi from "../world_api"

describe("selective replication", () => {
  const Position = Component.define<{x: number; y: number}>("Position")
  const schema = [Position]

  test("only record mutations for entities with Replicated tag", () => {
    const worldA = World.create({domainId: 1})
    const worldB = World.create({domainId: 2})
    World.addResource(worldA, ReplicationStream({transactions: [], snapshots: []}))

    let totalTransactionCount = 0
    function sync() {
      const stream = World.getResource(worldA, ReplicationStream)
      if (stream) {
        totalTransactionCount += stream.transactions.length
        for (const tx of stream.transactions) {
          applyTransaction(worldB, tx)
        }
        stream.transactions.length = 0
      }
    }

    const e1 = WorldApi.spawn(worldA, Position({x: 0, y: 0}))
    WorldApi.commitTransaction(worldA)
    sync()
    expect(totalTransactionCount).toBe(0)
    expect(World.getComponentValue(worldB, e1, Position)).toBeUndefined()

    WorldApi.addComponent(worldA, e1, Replicated)
    WorldApi.commitTransaction(worldA)
    sync()
    expect(totalTransactionCount).toBe(1)
    expect(World.getComponentValue(worldB, e1, Position)).toBeDefined()

    // Value-only changes no longer emit transactions (values go via snapshots)
    WorldApi.addComponent(worldA, e1, Position({x: 10, y: 10}))
    WorldApi.commitTransaction(worldA)
    sync()
    expect(totalTransactionCount).toBe(1) // no transaction for value change

    const e2 = WorldApi.spawn(worldA, Position({x: 100, y: 100}), Replicated)
    WorldApi.commitTransaction(worldA)
    sync()
    expect(totalTransactionCount).toBe(2)
    expect(World.getComponentValue(worldB, e2, Position)?.x).toBe(100)

    WorldApi.despawn(worldA, e2)
    WorldApi.commitTransaction(worldA)
    sync()
    expect(totalTransactionCount).toBe(3)
    expect(World.getComponentValue(worldB, e2, Position)).toBeUndefined()
  })
})
