import {describe, expect, test} from "bun:test"
import {defineComponent, type ComponentResolver} from "../component"
import {HistoryBuffer, pushSnapshot, type Snapshot} from "../history"
import {ByteWriter} from "../lib/binary"
import type {SnapshotMessage} from "../net_types"
import {All} from "../query/all"
import {Add, Read} from "../query/term"
import {
  applyRemoteSnapshots,
  applyRemoteTransactions,
  cleanupTransientEntities,
  performBatchReconciliation,
  pruneBuffers,
  receiveSnapshot,
  reconcileTransaction,
} from "../reconciliation"
import {TRANSIENT_DOMAIN, type Transaction} from "../replication"
import {
  IncomingSnapshots,
  IncomingTransactions,
  InputBuffer,
} from "../replication_config"
import {defineSystem} from "../system"
import {addSystem, makeSystemSchedule, runSchedule} from "../system_schedule"
import {getComponentValue, makeWorld} from "../world"
import {
  addComponent,
  addResource,
  advanceTick,
  commitTransaction,
  getResource,
  spawn,
  spawnInDomain,
} from "../world_api"

/**
 * Build a SnapshotMessage with _raw bytes from inline block data.
 */
function makeSnapshotMessage(
  tick: number,
  blocks: {componentId: number; entities: number[]; data: unknown[]}[],
  resolver: ComponentResolver,
): SnapshotMessage {
  const w = new ByteWriter()
  w.writeUint16(blocks.length)
  for (const block of blocks) {
    w.writeVarint(block.componentId)
    w.writeUint16(block.entities.length)
    const serde = resolver.getSerde(block.componentId)
    const isTag = resolver.isTag(block.componentId)
    for (let i = 0; i < block.entities.length; i++) {
      w.writeVarint(block.entities[i]!)
      if (!isTag && serde && block.data[i] !== undefined) {
        serde.encode(block.data[i], w)
      }
    }
  }
  return {tick, _raw: w.getBytes()}
}

describe("reconciliation", () => {
  const Position = defineComponent<{x: number; y: number}>({
    bytesPerElement: 16,
    encode: (val, writer) => {
      writer.writeFloat64(val.x)
      writer.writeFloat64(val.y)
    },
    decode: (reader) => ({x: reader.readFloat64(), y: reader.readFloat64()}),
  })

  test("reconcile late arriving transaction", () => {
    const world = makeWorld({domainId: 1, schema: [Position]})
    const history = {
      snapshots: [] as Snapshot[],
      checkpoints: [] as Snapshot[],
      undoLog: [] as any[],
      maxSize: 10,
      checkpointInterval: 1,
    }
    addResource(world, HistoryBuffer(history))
    const inputBuffer = new Map<number, unknown>()
    addResource(world, InputBuffer(inputBuffer))
    addResource(world, IncomingTransactions(new Map()))

    pushSnapshot(world, history)

    const entity = spawn(world, Position({x: 0, y: 0}))
    commitTransaction(world)
    advanceTick(world)

    inputBuffer.set(1, {dx: 1})
    addComponent(world, entity, Position({x: 1, y: 0}))
    commitTransaction(world)
    advanceTick(world)

    inputBuffer.set(2, {dx: 1})
    addComponent(world, entity, Position({x: 2, y: 0}))
    commitTransaction(world)
    advanceTick(world)

    expect(world.tick).toBe(3)
    const pos2 = getComponentValue(world, entity, Position)
    if (pos2) {
      expect(pos2.x).toBe(2)
    }

    const serverTransaction: Transaction = {
      domainId: 0,
      seq: 1,
      tick: 1,
      ops: [
        {
          type: "set",
          entity,
          componentId: world.componentRegistry.getId(Position),
          data: {x: 10, y: 0},
          version: 1,
        },
      ],
    }

    const tickFn = (w: typeof world, input: unknown) => {
      const pos = getComponentValue(w, entity, Position)
      const move = input as {dx: number} | undefined
      if (move && pos) {
        addComponent(w, entity, Position({x: pos.x + move.dx, y: pos.y}))
      }
    }

    reconcileTransaction(world, serverTransaction, tickFn)

    expect(world.tick).toBe(3)
    const posFinal = getComponentValue(world, entity, Position)
    if (posFinal) {
      expect(posFinal.x).toBe(11)
    }
  })

  test("prune buffers", () => {
    const world = makeWorld({domainId: 1, schema: [Position]})
    const history = {
      snapshots: [] as Snapshot[],
      checkpoints: [] as Snapshot[],
      undoLog: [] as any[],
      maxSize: 10,
      checkpointInterval: 1,
    }
    addResource(world, HistoryBuffer(history))
    const inputBuffer = new Map<number, unknown>()
    addResource(world, InputBuffer(inputBuffer))
    const incomingTransactions = new Map<number, Transaction[]>()
    addResource(world, IncomingTransactions(incomingTransactions))
    addResource(world, IncomingSnapshots(new Map()))

    for (let i = 0; i < 5; i++) {
      inputBuffer.set(i, {dx: i})
      incomingTransactions.set(i, [{domainId: 0, seq: i, tick: i, ops: []}])
      advanceTick(world)
    }

    expect(inputBuffer.size).toBe(5)
    expect(incomingTransactions.size).toBe(5)
    expect(history.checkpoints.length).toBe(5)

    pruneBuffers(world, 3)

    expect(inputBuffer.size).toBe(2)
    expect(inputBuffer.has(3)).toBe(true)
    expect(inputBuffer.has(4)).toBe(true)

    expect(incomingTransactions.size).toBe(2)
    expect(history.checkpoints.length).toBe(3)
    const firstCheckpoint = history.checkpoints[0]
    if (firstCheckpoint) {
      expect(firstCheckpoint.tick).toBe(3)
    }
  })

  test("cleanup rejected transient entities (ghosts)", () => {
    const world = makeWorld({domainId: 1, schema: [Position]})

    world.tick = 10
    const entity = spawnInDomain(
      world,
      [Position({x: 0, y: 0})],
      TRANSIENT_DOMAIN,
    )
    expect(world.transientRegistry.size).toBe(1)

    world.tick = 20

    cleanupTransientEntities(world, 15)

    expect(world.transientRegistry.size).toBe(0)
    expect(getComponentValue(world, entity, Position)).toBeUndefined()
  })

  test("receive and apply remote snapshots", () => {
    const world = makeWorld({domainId: 1, schema: [Position]})
    addResource(world, IncomingSnapshots(new Map()))

    const entity = spawn(world)
    commitTransaction(world)

    const snapshot = makeSnapshotMessage(
      0,
      [{
        componentId: world.componentRegistry.getId(Position),
        entities: [entity as number],
        data: [{x: 42, y: 43}],
      }],
      world.componentRegistry,
    )

    receiveSnapshot(world, snapshot)
    const incoming = getResource(world, IncomingSnapshots)
    expect(incoming?.has(0)).toBe(true)
    expect(incoming?.get(0)).toContain(snapshot)

    applyRemoteSnapshots(world)

    const pos = getComponentValue(world, entity, Position)
    expect(pos).toEqual({x: 42, y: 43})
    expect(incoming?.has(0)).toBe(false)
  })

  test("apply remote transactions", () => {
    const world = makeWorld({domainId: 1, schema: [Position]})
    addResource(world, IncomingTransactions(new Map()))

    const entity = spawn(world)
    commitTransaction(world)

    const transaction: Transaction = {
      domainId: 0,
      seq: 1,
      tick: 0,
      ops: [
        {
          type: "set",
          entity,
          componentId: world.componentRegistry.getId(Position),
          data: {x: 100, y: 200},
        },
      ],
    }

    const incoming = getResource(world, IncomingTransactions)
    if (incoming) {
      incoming.set(0, [transaction])
    }

    applyRemoteTransactions(world)

    const pos = getComponentValue(world, entity, Position)
    expect(pos).toEqual({x: 100, y: 200})
    expect(incoming?.has(0)).toBe(false)
  })

  test("performBatchReconciliation re-simulates multiple ticks", () => {
    const world = makeWorld({domainId: 1, schema: [Position]})
    const history = {
      snapshots: [] as Snapshot[],
      checkpoints: [] as Snapshot[],
      undoLog: [] as any[],
      maxSize: 10,
      checkpointInterval: 1,
    }
    addResource(world, HistoryBuffer(history))
    const incomingTransactions = new Map<number, Transaction[]>()
    addResource(world, IncomingTransactions(incomingTransactions))

    const moveSystem = defineSystem(
      (q: any, update: any) => {
        for (const [entity, pos] of q) {
          update(entity, {x: pos.x + 1, y: pos.y})
        }
      },
      {
        params: [All({entity: true}, Read(Position)), Add(Position)] as any,
        name: "move",
      },
    )

    const schedule = makeSystemSchedule()
    addSystem(schedule, moveSystem)

    // Tick 0
    const entity = spawn(world, Position({x: 0, y: 0}))
    runSchedule(schedule, world) // x -> 1
    commitTransaction(world)
    advanceTick(world) // world.tick = 1, pushes snapshot of state at START of tick 1 (x=1)

    // Tick 1
    runSchedule(schedule, world) // x -> 2
    commitTransaction(world)
    advanceTick(world) // world.tick = 2, pushes snapshot of state at START of tick 2 (x=2)

    // Tick 2
    runSchedule(schedule, world) // x -> 3
    commitTransaction(world)
    advanceTick(world) // world.tick = 3, pushes snapshot of state at START of tick 3 (x=3)

    expect(getComponentValue(world, entity, Position)?.x).toBe(3)

    // Inject a transaction at Tick 1 that teleports the entity to x=10
    const teleportTx: Transaction = {
      domainId: 0,
      seq: 1,
      tick: 1,
      ops: [
        {
          type: "set",
          entity,
          componentId: world.componentRegistry.getId(Position),
          data: {x: 10, y: 0},
        },
      ],
    }
    incomingTransactions.set(1, [teleportTx])

    // Perform batch reconciliation
    performBatchReconciliation(world, schedule)

    // Results of performBatchReconciliation (new order: transactions → systems):
    // 1. rollBackToTick(1): world.tick = 1, state = x:1 (start of tick 1)
    // 2. Loop world.tick=1 < 3:
    //    - applyTransaction(tick 1): x becomes 10 (teleport)
    //    - runSchedule: x becomes 11
    //    - advanceTick: world.tick = 2
    // 3. Loop world.tick=2 < 3:
    //    - no transactions
    //    - runSchedule: x becomes 12
    //    - advanceTick: world.tick = 3
    // 4. End.
    expect(world.tick).toBe(3)
    expect(getComponentValue(world, entity, Position)?.x).toBe(12)
    expect(incomingTransactions.has(1)).toBe(false)
  })

  test("performBatchReconciliation handles transactions older than history", () => {
    const world = makeWorld({domainId: 1, schema: [Position]})
    const history = {
      snapshots: [] as Snapshot[],
      checkpoints: [] as Snapshot[],
      undoLog: [] as any[],
      maxSize: 2,
      checkpointInterval: 1,
    } // Small history
    addResource(world, HistoryBuffer(history))
    const incomingTransactions = new Map<number, Transaction[]>()
    addResource(world, IncomingTransactions(incomingTransactions))

    const entity = spawn(world, Position({x: 0, y: 0}))
    commitTransaction(world)

    // Advance 5 ticks, only 2 snapshots will remain (maxSize=2)
    for (let i = 0; i < 5; i++) {
      advanceTick(world)
    }

    // world.tick is 5. history should contain snapshots for tick 4 and 5 (or similar).
    // Let's check oldest tick in history
    const oldestHistorySnapshot = history.snapshots[0]
    if (oldestHistorySnapshot) {
      const oldestHistoryTick = oldestHistorySnapshot.tick
      expect(oldestHistoryTick).toBeGreaterThan(0)
    }

    // Inject a transaction for tick 0 (older than oldest snapshot)
    const oldTx: Transaction = {
      domainId: 0,
      seq: 1,
      tick: 0,
      ops: [
        {
          type: "set",
          entity,
          componentId: world.componentRegistry.getId(Position),
          data: {x: 100, y: 0},
        },
      ],
    }
    incomingTransactions.set(0, [oldTx])

    const schedule = makeSystemSchedule()
    performBatchReconciliation(world, schedule)

    // The transaction should be applied directly because it's too old to rollback
    expect(getComponentValue(world, entity, Position)?.x).toBe(100)
    expect(incomingTransactions.has(0)).toBe(false)
  })
})
