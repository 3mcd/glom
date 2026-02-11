import {describe, expect, test} from "bun:test"
import * as commands from "../command"
import * as g from "../index"
import * as reconciliation from "../reconciliation"
import * as replication from "../replication"
import * as SnapshotStream from "../snapshot_stream"

// --- SCHEMA ---

const Position = g.Component.define<{x: number; y: number}>("Position", {
  bytesPerElement: 16,
  encode: (val, writer) => {
    writer.writeFloat64(val.x)
    writer.writeFloat64(val.y)
  },
  decode: (reader) => {
    return {x: reader.readFloat64(), y: reader.readFloat64()}
  },
})

const MoveCommand = g.Component.define<{dx: number; dy: number}>("MoveCommand", {
  bytesPerElement: 16,
  encode: (val, writer) => {
    writer.writeFloat64(val.dx)
    writer.writeFloat64(val.dy)
  },
  decode: (reader) => {
    return {dx: reader.readFloat64(), dy: reader.readFloat64()}
  },
})

const schema = [Position, MoveCommand]
const SPEED = 2

// --- WRITE-BASED MOVEMENT SYSTEM ---

const writeMovementSystem = g.System.define(
  (
    query: g.Join<
      g.All<g.Entity.Entity, g.Write<typeof Position>>,
      g.All<typeof MoveCommand>,
      typeof g.Command.CommandOf
    >,
  ) => {
    for (const [_entity, pos, move] of query) {
      const p = pos as {x: number; y: number}
      const m = move as {dx: number; dy: number}
      p.x += m.dx * SPEED
      p.y += m.dy * SPEED
    }
  },
  {
    params: [
      {
        join: [
          {all: [{entity: true}, {write: Position}]},
          {all: [MoveCommand]},
          g.Command.CommandOf,
        ],
      },
    ],
    name: "writeMovementSystem",
  },
)

// --- ADD-BASED MOVEMENT SYSTEM (for comparison) ---

const addMovementSystem = g.System.define(
  (
    query: g.Join<
      g.All<g.Entity.Entity, typeof Position>,
      g.All<typeof MoveCommand>,
      typeof g.Command.CommandOf
    >,
    update: g.Add<typeof Position>,
  ) => {
    for (const [entity, pos, move] of query) {
      const p = pos as {x: number; y: number}
      const m = move as {dx: number; dy: number}
      update(entity as g.Entity.Entity, {
        x: p.x + m.dx * SPEED,
        y: p.y + m.dy * SPEED,
      })
    }
  },
  {
    params: [
      {
        join: [
          {all: [{entity: true}, Position]},
          {all: [MoveCommand]},
          g.Command.CommandOf,
        ],
      },
      g.Add(Position),
    ],
    name: "addMovementSystem",
  },
)

// ==========================================================================
// TESTS
// ==========================================================================

describe("snapshot deep-cloning", () => {
  test("captureCheckpoint deep-clones object-typed component values", () => {
    const world = g.World.create({domainId: 0})
    const entity = g.World.spawn(world, Position({x: 10, y: 20}), g.Replicated)
    g.World.commitTransaction(world)

    const snapshot = g.History.capture(world)

    // Mutate the live store
    const livePos = g.World.getComponentValue(world, entity, Position)!
    livePos.x = 999
    livePos.y = 888

    // Snapshot should be unaffected
    const idx = snapshot.entityToIndex.get(entity)!
    const posId = world.componentRegistry.getId(Position)
    const snapshotStore = snapshot.componentData.get(posId)!
    const snapPos = snapshotStore[idx] as {x: number; y: number}

    expect(snapPos.x).toBe(10)
    expect(snapPos.y).toBe(20)
  })

  test("restoreCheckpoint restores independent copies (Write-safe)", () => {
    const world = g.World.create({domainId: 1})
    const history: g.History.HistoryBuffer = {
      checkpoints: [],
      undoLog: [],
      maxSize: 10,
      checkpointInterval: 1,
    }
    g.World.addResource(world, g.History.HistoryBuffer(history))

    const entity = g.World.spawn(world, Position({x: 5, y: 5}))
    g.World.commitTransaction(world)
    g.History.push(world, history) // snapshot at tick 0

    // Mutate in-place (simulate Write)
    const livePos = g.World.getComponentValue(world, entity, Position)!
    livePos.x = 100
    g.World.advanceTick(world) // tick becomes 1

    // Rollback to tick 0
    g.History.rollback(world, g.History.HistoryBuffer, 0)
    const restoredPos = g.World.getComponentValue(world, entity, Position)!
    expect(restoredPos.x).toBe(5)

    // Mutate the restored position (simulating Write after rollback)
    // The SNAPSHOT should remain unaffected
    restoredPos.x = 200

    const snapPosStore = history.checkpoints[0]!.componentData.get(
      world.componentRegistry.getId(Position),
    )!
    const snapPos = snapPosStore[
      g.SparseMap.get(world.index.entityToIndex, entity)!
    ] as {x: number; y: number}
    expect(snapPos.x).toBe(5) // Must not be corrupted
  })
})

describe("snapshot force-overwrite", () => {
  test("snapshot always overwrites position (forceSet)", () => {
    const world = g.World.create({domainId: 0})
    const entity = g.World.spawn(world, Position({x: 0, y: 0}), g.Replicated)
    g.World.commitTransaction(world)

    world.tick = 50

    const posId = world.componentRegistry.getId(Position)
    // Capture snapshot of current state (x=0,y=0) at tick 30
    const writer = new g.ByteWriter()
    g.writeSnapshot(writer, world, [posId], world.componentRegistry, 30)

    // Change position so we can verify the snapshot overwrites it
    const pos = g.World.getComponentValue(world, entity, Position)!
    pos.x = 0
    pos.y = 0

    // Now overwrite with a snapshot that carries the old values
    // To test force-overwrite with different data, set position first
    g.World.forceSetComponentValue(
      world,
      entity,
      Position,
      {x: 500, y: 500},
      world.tick,
    )
    expect(g.World.getComponentValue(world, entity, Position)!.x).toBe(500)

    // Apply the snapshot from tick 30 (which has x=0,y=0)
    const reader = new g.ByteReader(writer.getBytes())
    g.readMessageType(reader) // MessageType.Snapshot
    const tick = reader.readUint32()
    const message = g.readSnapshot(reader, tick)
    SnapshotStream.applySnapshotStream(world, message)

    // Authoritative: overwrites even though tick 30 < 50
    const posAfter = g.World.getComponentValue(world, entity, Position)!
    expect(posAfter.x).toBe(0)
    expect(posAfter.y).toBe(0)
  })
})

describe("end-to-end client prediction with Write + snapshots", () => {
  /**
   * Sets up server + client with initial handshake & entity delivery.
   * Client starts at the same tick as the server (no latency offset)
   * so rollback+replay can reach all server snapshot ticks.
   */
  function createSimulation(moveSys: any) {
    // ---- server ----
    const serverWorld = g.World.create({domainId: 0})
    g.World.addResource(
      serverWorld,
      g.ReplicationConfig({
        historyWindow: 64,
        snapshotComponents: [serverWorld.componentRegistry.getId(Position)],
      }),
    )
    g.World.addResource(
      serverWorld,
      g.History.HistoryBuffer({
        checkpoints: [],
        undoLog: [],
        maxSize: 120,
        checkpointInterval: 1,
      }),
    )
    g.World.addResource(
      serverWorld,
      g.ReplicationStream({transactions: [], snapshots: []}),
    )
    g.World.addResource(serverWorld, g.Command.CommandBuffer(new Map()))
    g.World.addResource(serverWorld, g.IncomingTransactions(new Map()))
    g.World.addResource(serverWorld, g.IncomingSnapshots(new Map()))

    const serverSchedule = g.SystemSchedule.create()
    g.SystemSchedule.add(serverSchedule, replication.clearReplicationStream)
    g.SystemSchedule.add(serverSchedule, reconciliation.applyRemoteTransactions)
    g.SystemSchedule.add(serverSchedule, commands.spawnEphemeralCommands)
    g.SystemSchedule.add(serverSchedule, moveSys)
    g.SystemSchedule.add(serverSchedule, commands.cleanupEphemeralCommands)
    g.SystemSchedule.add(serverSchedule, replication.commitPendingMutations)
    g.SystemSchedule.add(serverSchedule, replication.emitSnapshots)
    g.SystemSchedule.add(serverSchedule, replication.advanceWorldTick)
    g.SystemSchedule.add(serverSchedule, replication.pruneTemporalBuffers)

    // ---- spawn player ----
    const player = g.World.spawn(serverWorld, Position({x: 0, y: 0}), g.Replicated)

    // ---- server first tick → produces spawn transaction + snapshot ----
    g.SystemSchedule.run(serverSchedule, serverWorld as g.World.World)

    const stream = g.World.getResource(serverWorld, g.ReplicationStream)!
    const spawnTxPackets = stream.transactions.map((tx) => {
      const w = new g.ByteWriter()
      g.writeTransaction(w, tx, serverWorld.componentRegistry)
      return w.getBytes()
    })
    const snapshotPackets = stream.snapshots

    // ---- client ----
    const clientWorld = g.World.create({domainId: 1})
    const reconcileSchedule = g.SystemSchedule.create()
    g.SystemSchedule.add(reconcileSchedule, commands.spawnEphemeralCommands)
    g.SystemSchedule.add(reconcileSchedule, moveSys)
    g.SystemSchedule.add(reconcileSchedule, commands.cleanupEphemeralCommands)

    g.World.addResource(
      clientWorld,
      g.History.HistoryBuffer({
        checkpoints: [],
        undoLog: [],
        maxSize: 120,
        checkpointInterval: 1,
      }),
    )
    g.World.addResource(clientWorld, g.Command.CommandBuffer(new Map()))
    g.World.addResource(clientWorld, g.IncomingTransactions(new Map()))
    g.World.addResource(clientWorld, g.IncomingSnapshots(new Map()))
    g.World.addResource(
      clientWorld,
      g.ReplicationConfig({
        historyWindow: 64,
        ghostCleanupWindow: 60,
        reconcileSchedule,
      }),
    )

    const clientSchedule = g.SystemSchedule.create()
    g.SystemSchedule.add(clientSchedule, reconciliation.performRollback)
    g.SystemSchedule.add(clientSchedule, reconciliation.cleanupGhosts)
    g.SystemSchedule.add(clientSchedule, commands.spawnEphemeralCommands)
    g.SystemSchedule.add(clientSchedule, moveSys)
    g.SystemSchedule.add(clientSchedule, reconciliation.applyRemoteTransactions)
    g.SystemSchedule.add(clientSchedule, commands.cleanupEphemeralCommands)
    g.SystemSchedule.add(clientSchedule, replication.commitPendingMutations)
    g.SystemSchedule.add(clientSchedule, replication.advanceWorldTick)
    g.SystemSchedule.add(clientSchedule, replication.pruneTemporalBuffers)

    // ---- handshake: sync client clock to server tick (no latency offset) ----
    g.World.setTick(clientWorld, serverWorld.tick)
    const history = g.World.getResource(clientWorld, g.History.HistoryBuffer)!
    g.History.push(clientWorld, history) // empty-world snapshot

    // ---- deliver spawn transaction & snapshot ----
    for (const packet of spawnTxPackets) {
      const reader = new g.ByteReader(packet)
      g.readMessageType(reader) // MessageType.Transaction
      const tick = reader.readUint32()
      const transaction = g.readTransaction(
        reader,
        tick,
        serverWorld.componentRegistry,
      )
      g.receiveTransaction(clientWorld, transaction)
    }
    for (const packet of snapshotPackets) {
      const reader = new g.ByteReader(packet)
      g.readMessageType(reader) // MessageType.Snapshot
      const tick = reader.readUint32()
      const snapshot = g.readSnapshot(reader, tick)
      g.receiveSnapshot(clientWorld, snapshot)
    }

    // ---- let client process the spawn ----
    for (let i = 0; i < 3; i++) {
      g.SystemSchedule.run(clientSchedule, clientWorld as g.World.World)
    }

    // Verify entity exists on client
    const pos = g.World.getComponentValue(clientWorld, player, Position)
    if (!pos) {
      throw new Error(
        "Player entity not found on client after initial sync. " +
          `Client tick: ${clientWorld.tick}, Server tick: ${serverWorld.tick}`,
      )
    }

    return {
      serverWorld,
      serverSchedule,
      clientWorld,
      clientSchedule,
      player,
    }
  }

  /**
   * Simulates one server tick + delivers output to client (0 latency).
   */
  function serverTick(
    serverWorld: g.World.World,
    serverSchedule: g.SystemSchedule.SystemSchedule,
    clientWorld: g.World.World,
  ) {
    g.SystemSchedule.run(serverSchedule, serverWorld as g.World.World)

    const stream = g.World.getResource(serverWorld, g.ReplicationStream)
    if (!stream) return
    for (const tx of stream.transactions) {
      const w = new g.ByteWriter()
      g.writeTransaction(w, tx, serverWorld.componentRegistry)
      const reader = new g.ByteReader(w.getBytes())
      g.readMessageType(reader) // MessageType.Transaction
      const tick = reader.readUint32()
      const transaction = g.readTransaction(
        reader,
        tick,
        serverWorld.componentRegistry,
      )
      g.receiveTransaction(clientWorld, transaction)
    }
    for (const raw of stream.snapshots) {
      const reader = new g.ByteReader(raw)
      g.readMessageType(reader) // MessageType.Snapshot
      const tick = reader.readUint32()
      const snapshot = g.readSnapshot(reader, tick)
      g.receiveSnapshot(clientWorld, snapshot)
    }
  }

  /**
   * Sends client commands to the server (0 latency).
   */
  function sendCommands(clientWorld: g.World.World, serverWorld: g.World.World) {
    const commandBuffer = g.World.getResource(clientWorld, g.Command.CommandBuffer)
    const cmds = commandBuffer?.get(clientWorld.tick)
    if (!cmds || cmds.length === 0) return
    const writer = new g.ByteWriter()
    g.writeCommands(
      writer,
      clientWorld.tick,
      cmds,
      serverWorld.componentRegistry,
    )
    const reader = new g.ByteReader(writer.getBytes())
    const type = g.readMessageType(reader)
    const tick = reader.readUint32()
    if (type === g.MessageType.Command) {
      const commands = g.readCommands(reader, serverWorld.componentRegistry)
      const targetTick = Math.max(serverWorld.tick, tick)
      for (const cmd of commands) {
        g.Command.record(
          serverWorld,
          cmd.target as g.Entity.Entity,
          cmd,
          targetTick,
          tick,
        )
      }
    }
  }

  test("Write: client prediction preserved despite server snapshots", () => {
    const {serverWorld, serverSchedule, clientWorld, clientSchedule, player} =
      createSimulation(writeMovementSystem)

    const initialPos = g.World.getComponentValue(clientWorld, player, Position)!
    expect(initialPos.x).toBe(0)

    for (let i = 0; i < 50; i++) {
      // Server tick (delivers snapshots immediately, 0 latency)
      serverTick(serverWorld, serverSchedule, clientWorld)

      // Client records movement and ticks
      g.Command.record(clientWorld, player, MoveCommand({dx: 1, dy: 0}))
      sendCommands(clientWorld, serverWorld)

      g.SystemSchedule.run(clientSchedule, clientWorld as g.World.World)
    }

    // With 0 latency and rollback+replay, prediction should track closely
    const finalPos = g.World.getComponentValue(clientWorld, player, Position)!
    expect(finalPos.x).toBeGreaterThan(50)
  })

  test("Add: client prediction preserved despite server snapshots (control)", () => {
    const {serverWorld, serverSchedule, clientWorld, clientSchedule, player} =
      createSimulation(addMovementSystem)

    const initialPos = g.World.getComponentValue(clientWorld, player, Position)!
    expect(initialPos.x).toBe(0)

    for (let i = 0; i < 50; i++) {
      serverTick(serverWorld, serverSchedule, clientWorld)

      g.Command.record(clientWorld, player, MoveCommand({dx: 1, dy: 0}))
      sendCommands(clientWorld, serverWorld)

      g.SystemSchedule.run(clientSchedule, clientWorld as g.World.World)
    }

    const finalPos = g.World.getComponentValue(clientWorld, player, Position)!
    expect(finalPos.x).toBeGreaterThan(50)
  })

  test("Write: position monotonically increases with constant movement", () => {
    const {serverWorld, serverSchedule, clientWorld, clientSchedule, player} =
      createSimulation(writeMovementSystem)

    let prevX = 0
    let monotonicViolations = 0

    for (let i = 0; i < 80; i++) {
      serverTick(serverWorld, serverSchedule, clientWorld)

      g.Command.record(clientWorld, player, MoveCommand({dx: 1, dy: 0}))
      sendCommands(clientWorld, serverWorld)

      g.SystemSchedule.run(clientSchedule, clientWorld as g.World.World)

      const cPos = g.World.getComponentValue(clientWorld, player, Position)
      if (cPos) {
        if (cPos.x < prevX) {
          monotonicViolations++
          console.log(
            `  VIOLATION at tick ${i}: x went from ${prevX} to ${cPos.x} ` +
              `(client=${clientWorld.tick}, server=${serverWorld.tick})`,
          )
        }
        prevX = cPos.x
      }
    }

    expect(monotonicViolations).toBe(0)
    expect(prevX).toBeGreaterThan(50)
  })

  test("Add: position monotonically increases with constant movement (control)", () => {
    const {serverWorld, serverSchedule, clientWorld, clientSchedule, player} =
      createSimulation(addMovementSystem)

    let prevX = 0
    let monotonicViolations = 0

    for (let i = 0; i < 80; i++) {
      serverTick(serverWorld, serverSchedule, clientWorld)

      g.Command.record(clientWorld, player, MoveCommand({dx: 1, dy: 0}))
      sendCommands(clientWorld, serverWorld)

      g.SystemSchedule.run(clientSchedule, clientWorld as g.World.World)

      const cPos = g.World.getComponentValue(clientWorld, player, Position)
      if (cPos) {
        if (cPos.x < prevX) {
          monotonicViolations++
          console.log(
            `  VIOLATION at tick ${i}: x went from ${prevX} to ${cPos.x} ` +
              `(client=${clientWorld.tick}, server=${serverWorld.tick})`,
          )
        }
        prevX = cPos.x
      }
    }

    expect(monotonicViolations).toBe(0)
    expect(prevX).toBeGreaterThan(50)
  })

  test("Write: version trace during snapshot application", () => {
    const {serverWorld, serverSchedule, clientWorld, clientSchedule, player} =
      createSimulation(writeMovementSystem)

    const posId = clientWorld.componentRegistry.getId(Position)

    for (let i = 0; i < 30; i++) {
      serverTick(serverWorld, serverSchedule, clientWorld)

      g.Command.record(clientWorld, player, MoveCommand({dx: 1, dy: 0}))
      sendCommands(clientWorld, serverWorld)

      const idx = g.SparseMap.get(clientWorld.index.entityToIndex, player)
      const vBefore =
        idx !== undefined
          ? clientWorld.components.versions.get(posId)?.[idx]
          : "N/A"
      const posBefore = g.World.getComponentValue(clientWorld, player, Position)

      g.SystemSchedule.run(clientSchedule, clientWorld as g.World.World)

      const vAfter =
        idx !== undefined
          ? clientWorld.components.versions.get(posId)?.[idx]
          : "N/A"
      const posAfter = g.World.getComponentValue(clientWorld, player, Position)

      const incomingSnaps = g.World.getResource(clientWorld, g.IncomingSnapshots)
      const snapTicks = incomingSnaps ? Array.from(incomingSnaps.keys()) : []

      if (i < 20) {
        console.log(
          `  i=${i} clientTick=${clientWorld.tick} serverTick=${serverWorld.tick} ` +
            `ver=${vBefore}->${vAfter} ` +
            `pos=${posBefore ? Math.round(posBefore.x) : "?"}->${posAfter ? Math.round(posAfter.x) : "?"} ` +
            `pendingSnaps=[${snapTicks.join(",")}]`,
        )
      }
    }

    const finalPos = g.World.getComponentValue(clientWorld, player, Position)!
    expect(finalPos.x).toBeGreaterThan(20)
  })
})

// ==========================================================================
// LATENCY SIMULATION — reproduces real-world idle → movement transition
// ==========================================================================

describe("idle-to-movement transition with latency", () => {
  const LATENCY_FRAMES = 6

  class FramePipe {
    private messages: {deliveryFrame: number; packet: Uint8Array}[] = []

    send(packet: Uint8Array, currentFrame: number) {
      this.messages.push({
        deliveryFrame: currentFrame + LATENCY_FRAMES,
        packet: new Uint8Array(packet),
      })
    }

    receive(currentFrame: number): Uint8Array[] {
      const ready = this.messages.filter((m) => m.deliveryFrame <= currentFrame)
      this.messages = this.messages.filter(
        (m) => m.deliveryFrame > currentFrame,
      )
      return ready.map((m) => m.packet)
    }
  }

  function createLatencySim(moveSys: any, checkpointInterval = 5) {
    const serverToClient = new FramePipe()
    const clientToServer = new FramePipe()

    // ---- server ----
    const serverWorld = g.World.create({domainId: 0})
    g.World.addResource(
      serverWorld,
      g.ReplicationConfig({
        historyWindow: 64,
        snapshotComponents: [serverWorld.componentRegistry.getId(Position)],
      }),
    )
    g.World.addResource(
      serverWorld,
      g.History.HistoryBuffer({
        checkpoints: [],
        undoLog: [],
        maxSize: 120,
        checkpointInterval: 1,
      }),
    )
    g.World.addResource(
      serverWorld,
      g.ReplicationStream({transactions: [], snapshots: []}),
    )
    g.World.addResource(serverWorld, g.Command.CommandBuffer(new Map()))
    g.World.addResource(serverWorld, g.IncomingTransactions(new Map()))
    g.World.addResource(serverWorld, g.IncomingSnapshots(new Map()))

    const serverSchedule = g.SystemSchedule.create()
    g.SystemSchedule.add(serverSchedule, replication.clearReplicationStream)
    g.SystemSchedule.add(serverSchedule, reconciliation.applyRemoteTransactions)
    g.SystemSchedule.add(serverSchedule, commands.spawnEphemeralCommands)
    g.SystemSchedule.add(serverSchedule, moveSys)
    g.SystemSchedule.add(serverSchedule, commands.cleanupEphemeralCommands)
    g.SystemSchedule.add(serverSchedule, replication.commitPendingMutations)
    g.SystemSchedule.add(serverSchedule, replication.emitSnapshots)
    g.SystemSchedule.add(serverSchedule, replication.advanceWorldTick)
    g.SystemSchedule.add(serverSchedule, replication.pruneTemporalBuffers)

    // ---- spawn player ----
    const player = g.World.spawn(serverWorld, Position({x: 0, y: 0}), g.Replicated)

    // ---- server first tick → produces spawn transaction + snapshot ----
    g.SystemSchedule.run(serverSchedule, serverWorld as g.World.World)

    // ---- client ----
    const clientWorld = g.World.create({domainId: 1})
    const reconcileSchedule = g.SystemSchedule.create()
    g.SystemSchedule.add(reconcileSchedule, commands.spawnEphemeralCommands)
    g.SystemSchedule.add(reconcileSchedule, moveSys)
    g.SystemSchedule.add(reconcileSchedule, commands.cleanupEphemeralCommands)

    g.World.addResource(
      clientWorld,
      g.History.HistoryBuffer({
        checkpoints: [],
        undoLog: [],
        maxSize: 120,
        checkpointInterval,
      }),
    )
    g.World.addResource(clientWorld, g.Command.CommandBuffer(new Map()))
    g.World.addResource(clientWorld, g.IncomingTransactions(new Map()))
    g.World.addResource(clientWorld, g.IncomingSnapshots(new Map()))
    g.World.addResource(
      clientWorld,
      g.ReplicationConfig({
        historyWindow: 64,
        ghostCleanupWindow: 60,
        reconcileSchedule,
      }),
    )

    const clientSchedule = g.SystemSchedule.create()
    g.SystemSchedule.add(clientSchedule, reconciliation.performRollback)
    g.SystemSchedule.add(clientSchedule, reconciliation.cleanupGhosts)
    g.SystemSchedule.add(clientSchedule, commands.spawnEphemeralCommands)
    g.SystemSchedule.add(clientSchedule, moveSys)
    g.SystemSchedule.add(clientSchedule, reconciliation.applyRemoteTransactions)
    g.SystemSchedule.add(clientSchedule, commands.cleanupEphemeralCommands)
    g.SystemSchedule.add(clientSchedule, replication.commitPendingMutations)
    g.SystemSchedule.add(clientSchedule, replication.advanceWorldTick)
    g.SystemSchedule.add(clientSchedule, replication.pruneTemporalBuffers)

    // ---- handshake: deliver spawn immediately (simulating init) ----
    const targetTick = serverWorld.tick + 15 + LATENCY_FRAMES
    g.World.setTick(clientWorld, targetTick)
    const history = g.World.getResource(clientWorld, g.History.HistoryBuffer)!
    g.History.push(clientWorld, history)

    const stream = g.World.getResource(serverWorld, g.ReplicationStream)!
    for (const tx of stream.transactions) {
      const w = new g.ByteWriter()
      g.writeTransaction(w, tx, serverWorld.componentRegistry)
      const reader = new g.ByteReader(w.getBytes())
      g.readMessageType(reader) // MessageType.Transaction
      const tick = reader.readUint32()
      const transaction = g.readTransaction(
        reader,
        tick,
        serverWorld.componentRegistry,
      )
      g.receiveTransaction(clientWorld, transaction)
    }
    for (const raw of stream.snapshots) {
      const reader = new g.ByteReader(raw)
      g.readMessageType(reader) // MessageType.Snapshot
      const tick = reader.readUint32()
      const snapshot = g.readSnapshot(reader, tick)
      g.receiveSnapshot(clientWorld, snapshot)
    }

    // ---- let client process the spawn ----
    for (let i = 0; i < 3; i++) {
      g.SystemSchedule.run(clientSchedule, clientWorld as g.World.World)
    }

    const pos = g.World.getComponentValue(clientWorld, player, Position)
    if (!pos) {
      throw new Error(
        "Player entity not found on client after initial sync. " +
          `Client tick: ${clientWorld.tick}, Server tick: ${serverWorld.tick}`,
      )
    }

    return {
      serverWorld,
      serverSchedule,
      clientWorld,
      clientSchedule,
      player,
      serverToClient,
      clientToServer,
    }
  }

  function runFrame(
    frame: number,
    serverWorld: g.World.World,
    serverSchedule: g.SystemSchedule.SystemSchedule,
    clientWorld: g.World.World,
    clientSchedule: g.SystemSchedule.SystemSchedule,
    player: g.Entity.Entity,
    serverToClient: FramePipe,
    clientToServer: FramePipe,
    sendCommand: boolean,
  ) {
    // 1. Deliver client→server packets (commands)
    for (const packet of clientToServer.receive(frame)) {
      const reader = new g.ByteReader(packet)
      const type = g.readMessageType(reader)
      const tick = reader.readUint32()
      if (type === g.MessageType.Command) {
        const commands = g.readCommands(reader, serverWorld.componentRegistry)
        const targetTick = Math.max(serverWorld.tick, tick)
        for (const cmd of commands) {
          g.Command.record(
            serverWorld,
            cmd.target as g.Entity.Entity,
            cmd,
            targetTick,
            tick,
          )
        }
      }
    }

    // 2. Server tick
    g.SystemSchedule.run(serverSchedule, serverWorld as g.World.World)

    // 3. Server broadcasts replication into the pipe
    const stream = g.World.getResource(serverWorld, g.ReplicationStream)
    if (stream) {
      for (const tx of stream.transactions) {
        const w = new g.ByteWriter()
        g.writeTransaction(w, tx, serverWorld.componentRegistry)
        serverToClient.send(w.getBytes(), frame)
      }
      for (const raw of stream.snapshots) {
        serverToClient.send(raw, frame)
      }
    }

    // 4. Deliver server→client packets (transactions + snapshots)
    for (const packet of serverToClient.receive(frame)) {
      const reader = new g.ByteReader(packet)
      const type = g.readMessageType(reader)
      const tick = reader.readUint32()
      if (type === g.MessageType.Transaction) {
        const transaction = g.readTransaction(
          reader,
          tick,
          serverWorld.componentRegistry,
        )
        g.receiveTransaction(clientWorld, transaction)
      } else if (type === g.MessageType.Snapshot) {
        const snapshot = g.readSnapshot(reader, tick)
        g.receiveSnapshot(clientWorld, snapshot)
      }
    }

    // 5. Client records command (if moving) & sends it via pipe
    if (sendCommand) {
      g.Command.record(clientWorld, player, MoveCommand({dx: 1, dy: 0}))

      const commandBuffer = g.World.getResource(clientWorld, g.Command.CommandBuffer)
      const cmds = commandBuffer?.get(clientWorld.tick)
      if (cmds && cmds.length > 0) {
        const writer = new g.ByteWriter()
        g.writeCommands(
          writer,
          clientWorld.tick,
          cmds,
          serverWorld.componentRegistry,
        )
        clientToServer.send(writer.getBytes(), frame)
      }
    }

    // 6. Client tick
    g.SystemSchedule.run(clientSchedule, clientWorld as g.World.World)
  }

  test("Write: no jitter during idle→movement transition (checkpointInterval=5)", () => {
    const {
      serverWorld,
      serverSchedule,
      clientWorld,
      clientSchedule,
      player,
      serverToClient,
      clientToServer,
    } = createLatencySim(writeMovementSystem, 5)

    const IDLE_FRAMES = 30
    const MOVE_FRAMES = 60
    const posId = clientWorld.componentRegistry.getId(Position)

    let prevX = 0
    let moveTickCount = 0
    const violations: string[] = []

    for (let frame = 0; frame < IDLE_FRAMES + MOVE_FRAMES; frame++) {
      const isMoving = frame >= IDLE_FRAMES

      runFrame(
        frame,
        serverWorld,
        serverSchedule,
        clientWorld,
        clientSchedule,
        player,
        serverToClient,
        clientToServer,
        isMoving,
      )

      const pos = g.World.getComponentValue(clientWorld, player, Position)
      const x = pos?.x ?? 0
      const idx = g.SparseMap.get(clientWorld.index.entityToIndex, player)
      const ver =
        idx !== undefined
          ? clientWorld.components.versions.get(posId)?.[idx]
          : undefined

      if (isMoving) {
        moveTickCount++

        if (x < prevX) {
          violations.push(
            `REGRESSION at frame ${frame} (moveTick ${moveTickCount}): ` +
              `x=${prevX}→${x} ver=${ver} ` +
              `clientTick=${clientWorld.tick} serverTick=${serverWorld.tick}`,
          )
        } else if (x === prevX && moveTickCount > 1) {
          violations.push(
            `STALL at frame ${frame} (moveTick ${moveTickCount}): ` +
              `x=${x} ver=${ver} ` +
              `clientTick=${clientWorld.tick} serverTick=${serverWorld.tick}`,
          )
        }
      }

      if (frame >= IDLE_FRAMES - 2 && frame <= IDLE_FRAMES + 20) {
        console.log(
          `  frame=${frame} ${isMoving ? "MOVE" : "IDLE"} ` +
            `x=${x} ver=${ver} ` +
            `clientTick=${clientWorld.tick} serverTick=${serverWorld.tick}`,
        )
      }

      prevX = x
    }

    if (violations.length > 0) {
      console.log("\nViolations detected:")
      for (const v of violations) console.log(`  ${v}`)
    }

    expect(violations).toHaveLength(0)
    expect(prevX).toBeGreaterThan(50)
  })

  test("Write: no jitter during idle→movement transition (checkpointInterval=1)", () => {
    const {
      serverWorld,
      serverSchedule,
      clientWorld,
      clientSchedule,
      player,
      serverToClient,
      clientToServer,
    } = createLatencySim(writeMovementSystem, 1)

    const IDLE_FRAMES = 30
    const MOVE_FRAMES = 60
    const posId = clientWorld.componentRegistry.getId(Position)

    let prevX = 0
    let moveTickCount = 0
    const violations: string[] = []

    for (let frame = 0; frame < IDLE_FRAMES + MOVE_FRAMES; frame++) {
      const isMoving = frame >= IDLE_FRAMES

      runFrame(
        frame,
        serverWorld,
        serverSchedule,
        clientWorld,
        clientSchedule,
        player,
        serverToClient,
        clientToServer,
        isMoving,
      )

      const pos = g.World.getComponentValue(clientWorld, player, Position)
      const x = pos?.x ?? 0
      const idx = g.SparseMap.get(clientWorld.index.entityToIndex, player)
      const ver =
        idx !== undefined
          ? clientWorld.components.versions.get(posId)?.[idx]
          : undefined

      if (isMoving) {
        moveTickCount++

        if (x < prevX) {
          violations.push(
            `REGRESSION at frame ${frame} (moveTick ${moveTickCount}): ` +
              `x=${prevX}→${x} ver=${ver} ` +
              `clientTick=${clientWorld.tick} serverTick=${serverWorld.tick}`,
          )
        }
      }

      prevX = x
    }

    if (violations.length > 0) {
      console.log("\nViolations detected:")
      for (const v of violations) console.log(`  ${v}`)
    }

    expect(violations).toHaveLength(0)
    expect(prevX).toBeGreaterThan(50)
  })

  test("Add: no jitter during idle→movement transition (control)", () => {
    const {
      serverWorld,
      serverSchedule,
      clientWorld,
      clientSchedule,
      player,
      serverToClient,
      clientToServer,
    } = createLatencySim(addMovementSystem, 5)

    const IDLE_FRAMES = 30
    const MOVE_FRAMES = 60

    let prevX = 0
    let moveTickCount = 0
    const violations: string[] = []

    for (let frame = 0; frame < IDLE_FRAMES + MOVE_FRAMES; frame++) {
      const isMoving = frame >= IDLE_FRAMES

      runFrame(
        frame,
        serverWorld,
        serverSchedule,
        clientWorld,
        clientSchedule,
        player,
        serverToClient,
        clientToServer,
        isMoving,
      )

      const pos = g.World.getComponentValue(clientWorld, player, Position)
      const x = pos?.x ?? 0

      if (isMoving) {
        moveTickCount++

        if (x < prevX) {
          violations.push(
            `REGRESSION at frame ${frame} (moveTick ${moveTickCount}): ` +
              `x=${prevX}→${x} ` +
              `clientTick=${clientWorld.tick} serverTick=${serverWorld.tick}`,
          )
        }
      }

      prevX = x
    }

    if (violations.length > 0) {
      console.log("\nViolations detected:")
      for (const v of violations) console.log(`  ${v}`)
    }

    expect(violations).toHaveLength(0)
    expect(prevX).toBeGreaterThan(50)
  })
})
