import {describe, expect, test} from "bun:test"
import {defineComponent} from "../component"
import {HistoryBuffer, pushSnapshot, type Snapshot} from "../history"
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

describe("reconciliation", () => {
  const Position = defineComponent<{x: number; y: number}>()

  test("reconcile late arriving transaction", () => {
    const world = makeWorld({domainId: 1, schema: [Position]})
    const history: {snapshots: Snapshot[]; maxSize: number} = {
      snapshots: [],
      maxSize: 10,
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
    const history: {snapshots: Snapshot[]; maxSize: number} = {
      snapshots: [],
      maxSize: 10,
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
    expect(history.snapshots.length).toBe(5)

    pruneBuffers(world, 3)

    expect(inputBuffer.size).toBe(2)
    expect(inputBuffer.has(3)).toBe(true)
    expect(inputBuffer.has(4)).toBe(true)

    expect(incomingTransactions.size).toBe(2)
    expect(history.snapshots.length).toBe(3)
    const firstSnapshot = history.snapshots[0]
    if (firstSnapshot) {
      expect(firstSnapshot.tick).toBe(3)
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

    const snapshot = {
      tick: 0,
      blocks: [
        {
          componentId: world.componentRegistry.getId(Position),
          entities: [entity],
          data: [{x: 42, y: 43}],
        },
      ],
    }

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
    const history: {snapshots: Snapshot[]; maxSize: number} = {
      snapshots: [],
      maxSize: 10,
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

    // Results of performBatchReconciliation:
    // 1. rollBackToTick(1): world.tick = 1, state = x:1 (start of tick 1)
    // 2. Loop world.tick=1 < 3:
    //    - runSchedule: x becomes 2
    //    - applyTransaction(tick 1): x becomes 10 (teleport)
    //    - advanceTick: world.tick = 2
    // 3. Loop world.tick=2 < 3:
    //    - runSchedule: x becomes 11
    //    - advanceTick: world.tick = 3
    // 4. End.
    expect(world.tick).toBe(3)
    expect(getComponentValue(world, entity, Position)?.x).toBe(11)
    expect(incomingTransactions.has(1)).toBe(false)
  })

  test("performBatchReconciliation handles transactions older than history", () => {
    const world = makeWorld({domainId: 1, schema: [Position]})
    const history: {snapshots: Snapshot[]; maxSize: number} = {
      snapshots: [],
      maxSize: 2,
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
