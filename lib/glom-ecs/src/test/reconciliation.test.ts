import {describe, expect, test} from "bun:test"
import {defineComponent} from "../component"
import {HistoryBuffer, makeHistoryBuffer, pushSnapshot} from "../history"
import {
  applyRemoteSnapshots,
  applyRemoteTransactions,
  cleanupTransientEntities,
  pruneBuffers,
  receiveSnapshot,
  reconcileTransaction,
} from "../reconciliation"
import {
  applyTransaction,
  TRANSIENT_DOMAIN,
  type Transaction,
} from "../replication"
import {
  IncomingSnapshots,
  IncomingTransactions,
  InputBuffer,
} from "../replication_config"
import {getComponentValue, makeWorld} from "../world"
import {
  addComponent,
  addResource,
  advanceTick,
  commitTransaction,
  getResource,
  spawn,
} from "../world_api"

describe("reconciliation", () => {
  const Position = defineComponent<{x: number; y: number}>()

  test("reconcile late arriving transaction", () => {
    const world = makeWorld({domainId: 1, schema: [Position]})
    const history = {snapshots: [], maxSize: 10}
    addResource(world, HistoryBuffer(history))
    const inputBuffer = new Map<number, unknown>()
    addResource(world, InputBuffer(inputBuffer))
    addResource(world, IncomingTransactions(new Map()))

    pushSnapshot(world, history)

    const entity = spawn(world, [Position({x: 0, y: 0})])
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

    const tickFn = (w: typeof world, input: any) => {
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
    const history = {snapshots: [], maxSize: 10}
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
    if (history.snapshots.length > 0 && history.snapshots[0]) {
      expect(history.snapshots[0].tick).toBe(3)
    }
  })

  test("cleanup rejected transient entities (ghosts)", () => {
    const world = makeWorld({domainId: 1, schema: [Position]})

    world.tick = 10
    const entity = spawn(world, [Position({x: 0, y: 0})], TRANSIENT_DOMAIN)
    expect(world.transientRegistry.size).toBe(1)

    world.tick = 20

    cleanupTransientEntities(world, 15)

    expect(world.transientRegistry.size).toBe(0)
    expect(getComponentValue(world, entity, Position)).toBeUndefined()
  })

  test("receive and apply remote snapshots", () => {
    const world = makeWorld({domainId: 1, schema: [Position]})
    addResource(world, IncomingSnapshots(new Map()))

    const entity = spawn(world, [])
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

    const entity = spawn(world, [])
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

    const incoming = getResource(world, IncomingTransactions)!
    incoming.set(0, [transaction])

    applyRemoteTransactions(world)

    const pos = getComponentValue(world, entity, Position)
    expect(pos).toEqual({x: 100, y: 200})
    expect(incoming.has(0)).toBe(false)
  })
})
