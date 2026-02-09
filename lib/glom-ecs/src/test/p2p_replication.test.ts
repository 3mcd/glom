import {describe, expect, test} from "bun:test"
import {defineComponent} from "../component"
import {getComponentValue, makeVersion, makeWorld, getVersionTick, getVersionDomainId, setComponentValue} from "../world"
import {applySnapshotStreamVersioned, captureSnapshotStream} from "../snapshot_stream"
import {Replicated, ReplicationConfig} from "../replication_config"
import {addComponent, addResource, commitTransaction, getResource, spawn} from "../world_api"
import {applyTransaction} from "../replication"
import type {Transaction} from "../net_types"

const Position = defineComponent<{x: number; y: number}>({
  bytesPerElement: 8,
  encode: (val, writer) => {
    writer.writeFloat32(val.x)
    writer.writeFloat32(val.y)
  },
  decode: (reader) => ({x: reader.readFloat32(), y: reader.readFloat32()}),
})

const Health = defineComponent<number>({
  bytesPerElement: 4,
  encode: (val, writer) => writer.writeFloat32(val),
  decode: (reader) => reader.readFloat32(),
})

describe("composite version utilities", () => {
  test("makeVersion produces correct composite values", () => {
    const v = makeVersion(10, 5)
    expect(getVersionTick(v)).toBe(10)
    expect(getVersionDomainId(v)).toBe(5)
  })

  test("higher tick wins regardless of domainId", () => {
    expect(makeVersion(11, 0)).toBeGreaterThan(makeVersion(10, 5))
    expect(makeVersion(11, 0)).toBeGreaterThan(makeVersion(10, 2047))
  })

  test("same tick: higher domainId wins", () => {
    expect(makeVersion(10, 1)).toBeGreaterThan(makeVersion(10, 0))
    expect(makeVersion(10, 100)).toBeGreaterThan(makeVersion(10, 99))
  })

  test("roundtrip for boundary values", () => {
    const v0 = makeVersion(0, 0)
    expect(getVersionTick(v0)).toBe(0)
    expect(getVersionDomainId(v0)).toBe(0)

    const vMax = makeVersion(1000000, 2047)
    expect(getVersionTick(vMax)).toBe(1000000)
    expect(getVersionDomainId(vMax)).toBe(2047)
  })
})

describe("LWW via setComponentValue", () => {
  test("higher tick wins regardless of arrival order", () => {
    const world = makeWorld({domainId: 0, schema: [Position]})
    const entity = spawn(world, Position({x: 0, y: 0}), Replicated)
    const posId = world.componentRegistry.getId(Position)
    const comp = {id: posId, __component_brand: true} as any

    // Write at tick 10
    setComponentValue(world, entity, comp, {x: 10, y: 10}, makeVersion(10, 0))
    expect(getComponentValue(world, entity, Position)?.x).toBe(10)

    // Stale write at tick 5 — rejected
    setComponentValue(world, entity, comp, {x: 5, y: 5}, makeVersion(5, 0))
    expect(getComponentValue(world, entity, Position)?.x).toBe(10)

    // Newer write at tick 20 — accepted
    setComponentValue(world, entity, comp, {x: 20, y: 20}, makeVersion(20, 0))
    expect(getComponentValue(world, entity, Position)?.x).toBe(20)
  })

  test("same-tick tiebreaker: higher domainId wins", () => {
    const world = makeWorld({domainId: 0, schema: [Position]})
    const entity = spawn(world, Position({x: 0, y: 0}), Replicated)
    const posId = world.componentRegistry.getId(Position)
    const comp = {id: posId, __component_brand: true} as any

    // Peer 0 writes at tick 10
    setComponentValue(world, entity, comp, {x: 100, y: 0}, makeVersion(10, 0))
    expect(getComponentValue(world, entity, Position)?.x).toBe(100)

    // Peer 1 writes at same tick 10, higher domainId wins
    setComponentValue(world, entity, comp, {x: 200, y: 0}, makeVersion(10, 1))
    expect(getComponentValue(world, entity, Position)?.x).toBe(200)

    // Peer 0 arrives late at same tick — lower domainId rejected
    setComponentValue(world, entity, comp, {x: 50, y: 0}, makeVersion(10, 0))
    expect(getComponentValue(world, entity, Position)?.x).toBe(200)
  })
})

describe("applySnapshotStreamVersioned", () => {
  test("stale snapshot does not overwrite newer local value", () => {
    const world = makeWorld({domainId: 1, schema: [Position]})
    const entity = spawn(world, Position({x: 50, y: 50}), Replicated)
    const posId = world.componentRegistry.getId(Position)

    // Set version to tick 50 by writing at that version
    setComponentValue(
      world,
      entity,
      {id: posId, __component_brand: true} as any,
      {x: 50, y: 50},
      50,
    )

    const staleSnapshot = {
      tick: 40,
      blocks: [{componentId: posId, entities: [entity as number], data: [{x: 40, y: 40}]}],
    }
    applySnapshotStreamVersioned(world, staleSnapshot)
    // Should NOT overwrite — local version (50) > snapshot tick (40)
    expect(getComponentValue(world, entity, Position)?.x).toBe(50)
  })

  test("newer snapshot overwrites older local value", () => {
    const world = makeWorld({domainId: 1, schema: [Position]})
    const entity = spawn(world, Position({x: 50, y: 50}), Replicated)
    const posId = world.componentRegistry.getId(Position)

    const newerSnapshot = {
      tick: 60,
      blocks: [{componentId: posId, entities: [entity as number], data: [{x: 60, y: 60}]}],
    }
    applySnapshotStreamVersioned(world, newerSnapshot)
    expect(getComponentValue(world, entity, Position)?.x).toBe(60)
  })
})

describe("emitValueTransactions", () => {
  test("commitTransaction emits set ops when emitValueTransactions is true", () => {
    const world = makeWorld({domainId: 1, schema: [Position, Health, ReplicationConfig]})
    addResource(world, ReplicationConfig({emitValueTransactions: true}))

    const entity = spawn(world, Position({x: 0, y: 0}), Replicated)

    // Update the position (entity already has Position → set op)
    addComponent(world, entity, Position({x: 10, y: 10}))

    // Check pending ops — should have a "set" op
    const setOps = world.pendingOps.filter(
      (op) => op.type === "set" && op.entity === entity,
    )
    expect(setOps.length).toBe(1)
    expect(setOps[0]!.data).toEqual({x: 10, y: 10})
    expect(setOps[0]!.version).toBeDefined()
  })

  test("commitTransaction drops set ops when emitValueTransactions is false/unset", () => {
    const world = makeWorld({domainId: 1, schema: [Position]})
    const entity = spawn(world, Position({x: 0, y: 0}), Replicated)

    // Update the position (entity already has Position)
    addComponent(world, entity, Position({x: 10, y: 10}))

    // Check pending ops — should NOT have a "set" op
    const setOps = world.pendingOps.filter(
      (op) => op.type === "set" && op.entity === entity,
    )
    expect(setOps.length).toBe(0)
  })

  test("set ops carry composite version with domainId", () => {
    const world = makeWorld({domainId: 5, schema: [Position, ReplicationConfig]})
    world.tick = 42
    addResource(world, ReplicationConfig({emitValueTransactions: true}))

    const entity = spawn(world, Position({x: 0, y: 0}), Replicated)
    addComponent(world, entity, Position({x: 10, y: 10}))

    const setOps = world.pendingOps.filter(
      (op) => op.type === "set" && op.entity === entity,
    )
    expect(setOps.length).toBe(1)
    const version = setOps[0]!.version!
    expect(getVersionTick(version)).toBe(42)
    expect(getVersionDomainId(version)).toBe(5)
  })
})

describe("P2P reconciliation", () => {
  test("two peers with concurrent mutations converge via LWW", () => {
    // Peer A (domainId=1) and Peer B (domainId=2) both have the same entity
    const peerA = makeWorld({domainId: 1, schema: [Position]})
    const peerB = makeWorld({domainId: 2, schema: [Position]})

    // Spawn entity on Peer A
    peerA.tick = 10
    const entity = spawn(peerA, Position({x: 0, y: 0}), Replicated)
    const posId = peerA.componentRegistry.getId(Position)

    // Replicate spawn to Peer B via transaction
    const spawnTx: Transaction = {
      domainId: 1,
      seq: 0,
      tick: 10,
      ops: [
        {
          type: "spawn",
          entity,
          components: [{id: posId, data: {x: 0, y: 0}}, {id: Replicated.id}],
        },
      ],
    }
    peerB.tick = 10
    applyTransaction(peerB, spawnTx)

    // Both peers write concurrently at tick 15
    peerA.tick = 15
    peerB.tick = 15

    // Peer A writes x=100
    setComponentValue(
      peerA,
      entity,
      {id: posId, __component_brand: true} as any,
      {x: 100, y: 0},
      makeVersion(15, 1), // domainId=1
    )

    // Peer B writes x=200
    setComponentValue(
      peerB,
      entity,
      {id: posId, __component_brand: true} as any,
      {x: 200, y: 0},
      makeVersion(15, 2), // domainId=2
    )

    // Now exchange: Peer A receives Peer B's write (via set op in a transaction)
    const setTxFromB: Transaction = {
      domainId: 2,
      seq: 0,
      tick: 15,
      ops: [
        {
          type: "set",
          entity,
          componentId: posId,
          data: {x: 200, y: 0},
          version: makeVersion(15, 2),
        },
      ],
    }
    applyTransaction(peerA, setTxFromB)

    // Peer B receives Peer A's write (via set op in a transaction)
    const setTxFromA: Transaction = {
      domainId: 1,
      seq: 0,
      tick: 15,
      ops: [
        {
          type: "set",
          entity,
          componentId: posId,
          data: {x: 100, y: 0},
          version: makeVersion(15, 1),
        },
      ],
    }
    applyTransaction(peerB, setTxFromA)

    // Both peers should converge to Peer B's value (higher domainId wins)
    expect(getComponentValue(peerA, entity, Position)?.x).toBe(200)
    expect(getComponentValue(peerB, entity, Position)?.x).toBe(200)
  })

  test("versioned snapshot from slower peer does not overwrite faster peer's value", () => {
    const world = makeWorld({domainId: 1, schema: [Position]})
    world.tick = 20
    const entity = spawn(world, Position({x: 0, y: 0}), Replicated)
    const posId = world.componentRegistry.getId(Position)

    // Local write at tick 20
    setComponentValue(
      world,
      entity,
      {id: posId, __component_brand: true} as any,
      {x: 100, y: 100},
      makeVersion(20, 1),
    )

    // Receive snapshot from slower peer at tick 15
    const slowSnapshot = {
      tick: makeVersion(15, 2), // even with higher domainId, tick 15 < 20
      blocks: [{componentId: posId, entities: [entity as number], data: [{x: 50, y: 50}]}],
    }
    applySnapshotStreamVersioned(world, slowSnapshot)

    // Note: applySnapshotStreamVersioned uses message.tick as the version.
    // makeVersion(15, 2) = 15 * 2048 + 2 = 30722
    // makeVersion(20, 1) = 20 * 2048 + 1 = 40961
    // So local value wins because 40961 > 30722
    expect(getComponentValue(world, entity, Position)?.x).toBe(100)
  })

  test("bidirectional snapshot exchange converges", () => {
    const peerA = makeWorld({domainId: 1, schema: [Position]})
    const peerB = makeWorld({domainId: 2, schema: [Position]})

    peerA.tick = 10
    peerB.tick = 10

    const entity = spawn(peerA, Position({x: 0, y: 0}), Replicated)
    const posId = peerA.componentRegistry.getId(Position)

    // Replicate to B
    const spawnTx: Transaction = {
      domainId: 1,
      seq: 0,
      tick: 10,
      ops: [
        {
          type: "spawn",
          entity,
          components: [{id: posId, data: {x: 0, y: 0}}, {id: Replicated.id}],
        },
      ],
    }
    applyTransaction(peerB, spawnTx)

    // Peer A moves forward to tick 20
    peerA.tick = 20
    setComponentValue(
      peerA,
      entity,
      {id: posId, __component_brand: true} as any,
      {x: 50, y: 50},
      makeVersion(20, 1),
    )

    // Peer B moves forward to tick 18
    peerB.tick = 18
    setComponentValue(
      peerB,
      entity,
      {id: posId, __component_brand: true} as any,
      {x: 99, y: 99},
      makeVersion(18, 2),
    )

    // Exchange snapshots
    const snapA = captureSnapshotStream(peerA, [posId])
    const snapB = captureSnapshotStream(peerB, [posId])

    // Apply B's snapshot to A (versioned)
    applySnapshotStreamVersioned(peerA, {
      tick: makeVersion(18, 2),
      blocks: snapB,
    })

    // Apply A's snapshot to B (versioned)
    applySnapshotStreamVersioned(peerB, {
      tick: makeVersion(20, 1),
      blocks: snapA,
    })

    // Peer A should keep its own value (tick 20 > tick 18)
    expect(getComponentValue(peerA, entity, Position)?.x).toBe(50)

    // Peer B should accept A's value (tick 20 > tick 18)
    expect(getComponentValue(peerB, entity, Position)?.x).toBe(50)
  })
})

