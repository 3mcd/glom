import {expect, test} from "bun:test"
import * as commands from "../command"
import * as g from "../index"
import * as reconciliation from "../reconciliation"
import * as replication from "../replication"

// --- SCHEMA & SYSTEMS ---

const Position = g.defineComponent<{x: number; y: number}>("Position", {
  bytesPerElement: 16,
  encode: (val, writer) => {
    writer.writeFloat64(val.x)
    writer.writeFloat64(val.y)
  },
  decode: (reader) => {
    return {x: reader.readFloat64(), y: reader.readFloat64()}
  },
})

const MoveCommand = g.defineComponent<{dx: number; dy: number}>("MoveCommand", {
  bytesPerElement: 16,
  encode: (val, writer) => {
    writer.writeFloat64(val.dx)
    writer.writeFloat64(val.dy)
  },
  decode: (reader) => {
    return {dx: reader.readFloat64(), dy: reader.readFloat64()}
  },
})

const FireCommand = g.defineTag("FireCommand")

const Pulse = g.defineComponent<number>("Pulse", {
  bytesPerElement: 8,
  encode: (val, writer) => {
    writer.writeFloat64(val)
  },
  decode: (reader) => {
    return reader.readFloat64()
  },
})

const PulseOf = g.defineRelation("PulseOf")

const schema = [Position, MoveCommand, FireCommand, Pulse, PulseOf]

const SPEED = 2

const movementSystem = g.defineSystem(
  (
    query: g.Join<
      g.All<g.Entity, typeof Position>,
      g.All<typeof MoveCommand>,
      typeof g.CommandOf
    >,
    update: g.Add<typeof Position>,
  ) => {
    for (const [entity, pos, move] of query) {
      update(entity, {
        x: pos.x + move.dx * SPEED,
        y: pos.y + move.dy * SPEED,
      })
    }
  },
  {
    params: [
      {
        join: [
          {all: [{entity: true}, Position]},
          {all: [MoveCommand]},
          g.CommandOf,
        ],
      },
      g.Add(Position),
    ],
    name: "movementSystem",
  },
)

const pulseSpawnerSystem = g.defineSystem(
  (
    query: g.Join<
      g.All<g.Entity, typeof Position>,
      g.All<g.Has<typeof FireCommand>, typeof g.IntentTick>,
      typeof g.CommandOf
    >,
    world: g.World,
  ) => {
    for (const [playerEnt, pos, _hasFire, intentTick] of query) {
      g.spawnInDomain(
        world,
        [Position({...pos}), Pulse(5), PulseOf(playerEnt), g.Replicated],
        world.registry.domainId,
        intentTick,
      )
    }
  },
  {
    params: [
      {
        join: [
          {all: [{entity: true}, Position]},
          {all: [{has: FireCommand}, g.IntentTick]},
          g.CommandOf,
        ],
      },
      g.WorldTerm(),
    ],
    name: "pulseSpawnerSystem",
  },
)

const attachedPulseSystem = g.defineSystem(
  (
    pulses: g.Join<
      g.All<g.Entity, typeof Position>,
      g.All<typeof Position>,
      typeof PulseOf
    >,
    update: g.Add<typeof Position>,
  ) => {
    for (const [pulseEnt, _pos, parentPos] of pulses) {
      update(pulseEnt, {
        x: parentPos.x,
        y: parentPos.y,
      })
    }
  },
  {
    params: [
      {
        join: [{all: [{entity: true}, Position]}, {all: [Position]}, PulseOf],
      },
      g.Add(Position),
    ],
    name: "attachedPulseSystem",
  },
)

// --- INFRASTRUCTURE ---

class MockPipe {
  private messages: {deliveryTick: number; packet: Uint8Array}[] = []

  send(packet: Uint8Array, currentTick: number, delayTicks: number) {
    this.messages.push({
      deliveryTick: currentTick + delayTicks,
      packet: new Uint8Array(packet),
    })
  }

  receive(currentTick: number): Uint8Array[] {
    const ready = this.messages.filter((m) => m.deliveryTick <= currentTick)
    this.messages = this.messages.filter((m) => m.deliveryTick > currentTick)
    return ready.map((m) => m.packet)
  }
}

function setupServer() {
  const world = g.makeWorld({domainId: 0})
  const schedule = g.makeSystemSchedule()

  g.addResource(
    world,
    g.ReplicationConfig({
      historyWindow: 64,
    }),
  )
  g.addResource(world, g.ReplicationStream({transactions: [], snapshots: []}))
  g.addResource(world, g.CommandBuffer(new Map()))
  g.addResource(world, g.IncomingTransactions(new Map()))
  g.addResource(world, g.IncomingSnapshots(new Map()))

  g.addSystem(schedule, reconciliation.applyRemoteTransactions)
  g.addSystem(schedule, commands.spawnEphemeralCommands)
  g.addSystem(schedule, movementSystem)
  g.addSystem(schedule, pulseSpawnerSystem)
  g.addSystem(schedule, attachedPulseSystem)
  g.addSystem(schedule, commands.cleanupEphemeralCommands)
  g.addSystem(schedule, replication.commitPendingMutations)
  g.addSystem(schedule, replication.advanceWorldTick)

  return {world, schedule}
}

function setupClient(domainId: number) {
  const world = g.makeWorld({domainId})
  g.addResource(
    world,
    g.HistoryBuffer({
      checkpoints: [],
      undoLog: [],
      maxSize: 120,
      checkpointInterval: 1,
    }),
  )
  g.addResource(world, g.CommandBuffer(new Map()))
  g.addResource(world, g.IncomingTransactions(new Map()))
  g.addResource(world, g.IncomingSnapshots(new Map()))
  g.addResource(world, g.InputBuffer(new Map()))

  const reconcileSchedule = g.makeSystemSchedule()
  g.addSystem(reconcileSchedule, commands.spawnEphemeralCommands)
  g.addSystem(reconcileSchedule, movementSystem)
  g.addSystem(reconcileSchedule, pulseSpawnerSystem)
  g.addSystem(reconcileSchedule, attachedPulseSystem)
  g.addSystem(reconcileSchedule, commands.cleanupEphemeralCommands)

  const schedule = g.makeSystemSchedule()

  g.addResource(
    world,
    g.ReplicationConfig({
      historyWindow: 64,
      ghostCleanupWindow: 20,
      reconcileSchedule: reconcileSchedule,
    }),
  )

  g.addSystem(schedule, reconciliation.performRollback)
  g.addSystem(schedule, reconciliation.cleanupGhosts)
  g.addSystem(schedule, commands.spawnEphemeralCommands)
  g.addSystem(schedule, movementSystem)
  g.addSystem(schedule, pulseSpawnerSystem)
  g.addSystem(schedule, attachedPulseSystem)
  g.addSystem(schedule, reconciliation.applyRemoteTransactions)
  g.addSystem(schedule, commands.cleanupEphemeralCommands)
  g.addSystem(schedule, replication.commitPendingMutations)
  g.addSystem(schedule, replication.advanceWorldTick)

  return {world, schedule}
}

// --- NETWORK SIMULATION HELPER ---

class NetworkSimulation {
  readonly clientToServer = new MockPipe()
  readonly serverToClient = new MockPipe()

  constructor(
    public server: ReturnType<typeof setupServer>,
    public client: ReturnType<typeof setupClient>,
    public latencyTicks: number,
  ) {}

  processClientToServer() {
    for (const packet of this.clientToServer.receive(this.server.world.tick)) {
      const reader = new g.ByteReader(packet)
      const header = g.readMessageHeader(reader)
      if (header.type === g.MessageType.Command) {
        const commands = g.readCommands(
          reader,
          this.server.world.componentRegistry,
        )
        const targetTick = Math.max(this.server.world.tick, header.tick)
        for (const cmd of commands) {
          g.recordCommand(
            this.server.world,
            cmd.target as g.Entity,
            cmd,
            targetTick,
            header.tick,
          )
        }
      }
    }
  }

  processServerToClient(onHandshake?: (handshake: g.HandshakeServer) => void) {
    for (const packet of this.serverToClient.receive(this.client.world.tick)) {
      const reader = new g.ByteReader(packet)
      const header = g.readMessageHeader(reader)
      if (header.type === g.MessageType.Handshake) {
        const handshake = g.readHandshakeServer(reader)
        onHandshake?.(handshake)
      } else if (header.type === g.MessageType.Transaction) {
        const transaction = g.readTransaction(
          reader,
          header.tick,
          this.server.world.componentRegistry,
        )
        g.receiveTransaction(this.client.world, transaction)
      }
    }
  }

  broadcastReplication() {
    const stream = g.getResource(this.server.world, g.ReplicationStream)
    if (stream) {
      for (const transaction of stream.transactions) {
        const writer = new g.ByteWriter()
        g.writeTransaction(
          writer,
          transaction,
          this.server.world.componentRegistry,
        )
        this.serverToClient.send(
          writer.getBytes(),
          this.server.world.tick,
          this.latencyTicks,
        )
      }
      for (const raw of stream.snapshots) {
        this.serverToClient.send(raw, this.server.world.tick, this.latencyTicks)
      }
      stream.transactions.length = 0
      stream.snapshots.length = 0
    }
  }

  sendClientCommands() {
    const commandBuffer = g.getResource(this.client.world, g.CommandBuffer)
    const commands = commandBuffer?.get(this.client.world.tick)
    if (commands) {
      const writer = new g.ByteWriter()
      g.writeCommands(
        writer,
        this.client.world.tick,
        commands,
        this.server.world.componentRegistry,
      )
      this.clientToServer.send(
        writer.getBytes(),
        this.client.world.tick,
        this.latencyTicks,
      )
    }
  }
}

// --- TESTS ---

test("rigorous straight-line movement isomorphism", () => {
  const LATENCY_TICKS = 5
  const sim = new NetworkSimulation(
    setupServer(),
    setupClient(1),
    LATENCY_TICKS,
  )
  const {world: serverWorld, schedule: serverSchedule} = sim.server
  const {world: clientWorld, schedule: clientSchedule} = sim.client

  const player = g.spawn(serverWorld, Position({x: 0, y: 0}), g.Replicated)

  const handshakeWriter = new g.ByteWriter()
  g.writeHandshakeServer(handshakeWriter, serverWorld.tick, {
    domainId: 0,
    tick: serverWorld.tick,
  })
  sim.serverToClient.send(handshakeWriter.getBytes(), 0, LATENCY_TICKS)

  let clientSynced = false
  const serverPositions: Map<number, {x: number; y: number}> = new Map()

  for (let tick = 0; tick < 200; tick++) {
    sim.processClientToServer()

    const sPosBefore = g.getComponentValue(serverWorld, player, Position)
    if (sPosBefore) {
      serverPositions.set(serverWorld.tick, {...sPosBefore})
    }

    g.runSchedule(serverSchedule, serverWorld as g.World)
    sim.broadcastReplication()

    sim.processServerToClient((handshake) => {
      if (!clientSynced) {
        clientWorld.tick = handshake.tick + LATENCY_TICKS * 3
        const history = g.getResource(clientWorld, g.HistoryBuffer)
        if (history) g.pushCheckpoint(clientWorld, history)
        clientSynced = true
      }
    })

    if (clientSynced) {
      g.recordCommand(clientWorld, player, MoveCommand({dx: 1, dy: 0}))
      sim.sendClientCommands()

      g.runSchedule(clientSchedule, clientWorld as g.World)

      const checkTick = tick - LATENCY_TICKS
      if (checkTick >= 0) {
        const sPos = serverPositions.get(checkTick)
        const history = g.getResource(clientWorld, g.HistoryBuffer)
        const snapshot = history?.checkpoints.find((s) => s.tick === checkTick)

        if (sPos && snapshot) {
          const playerIdx = snapshot.entityToIndex.get(player)
          const posStore = snapshot.componentData.get(
            clientWorld.componentRegistry.getId(Position),
          )
          if (playerIdx !== undefined && posStore) {
            const reconciledPos = posStore[playerIdx] as {x: number; y: number}
            expect(reconciledPos.x).toBeCloseTo(sPos.x)
            expect(reconciledPos.y).toBeCloseTo(sPos.y)
          }
        }
      }
    }
  }
})

test("stop-and-go movement isomorphism", () => {
  const LATENCY_TICKS = 5
  const sim = new NetworkSimulation(
    setupServer(),
    setupClient(1),
    LATENCY_TICKS,
  )
  const {world: serverWorld, schedule: serverSchedule} = sim.server
  const {world: clientWorld, schedule: clientSchedule} = sim.client

  const player = g.spawn(serverWorld, Position({x: 0, y: 0}), g.Replicated)

  const handshakeWriter = new g.ByteWriter()
  g.writeHandshakeServer(handshakeWriter, serverWorld.tick, {
    domainId: 0,
    tick: serverWorld.tick,
  })
  sim.serverToClient.send(handshakeWriter.getBytes(), 0, LATENCY_TICKS)

  let clientSynced = false
  const serverPositions: Map<number, {x: number; y: number}> = new Map()

  for (let tick = 0; tick < 200; tick++) {
    sim.processClientToServer()

    const sPosBefore = g.getComponentValue(serverWorld, player, Position)
    if (sPosBefore) {
      serverPositions.set(serverWorld.tick, {...sPosBefore})
    }

    g.runSchedule(serverSchedule, serverWorld as g.World)
    sim.broadcastReplication()

    sim.processServerToClient((handshake) => {
      if (!clientSynced) {
        clientWorld.tick = handshake.tick + LATENCY_TICKS * 3
        clientSynced = true
      }
    })

    if (clientSynced) {
      if (tick >= 50 && tick < 100) {
        g.recordCommand(clientWorld, player, MoveCommand({dx: 1, dy: 0}))
      }
      sim.sendClientCommands()

      g.runSchedule(clientSchedule, clientWorld as g.World)

      const checkTick = tick - LATENCY_TICKS
      if (checkTick >= 0) {
        const sPos = serverPositions.get(checkTick)
        const history = g.getResource(clientWorld, g.HistoryBuffer)
        const snapshot = history?.checkpoints.find((s) => s.tick === checkTick)

        if (sPos && snapshot) {
          const playerIdx = snapshot.entityToIndex.get(player)
          const posStore = snapshot.componentData.get(
            clientWorld.componentRegistry.getId(Position),
          )
          if (playerIdx !== undefined && posStore) {
            const reconciledPos = posStore[playerIdx] as {x: number; y: number}
            expect(reconciledPos.x).toBeCloseTo(sPos.x)
            expect(reconciledPos.y).toBeCloseTo(sPos.y)
          }
        }
      }
    }
  }
})

test("predictive spawning and rebinding isomorphism", () => {
  const LATENCY_TICKS = 5
  const sim = new NetworkSimulation(
    setupServer(),
    setupClient(1),
    LATENCY_TICKS,
  )
  const {world: serverWorld, schedule: serverSchedule} = sim.server
  const {world: clientWorld, schedule: clientSchedule} = sim.client

  const player = g.spawn(serverWorld, Position({x: 0, y: 0}), g.Replicated)

  const handshakeWriter = new g.ByteWriter()
  g.writeHandshakeServer(handshakeWriter, serverWorld.tick, {
    domainId: 0,
    tick: serverWorld.tick,
  })
  sim.serverToClient.send(handshakeWriter.getBytes(), 0, LATENCY_TICKS)

  let clientSynced = false
  let spawnTriggered = false

  for (let tick = 0; tick < 100; tick++) {
    sim.processClientToServer()
    g.runSchedule(serverSchedule, serverWorld as g.World)
    sim.broadcastReplication()

    sim.processServerToClient((handshake) => {
      if (!clientSynced) {
        clientWorld.tick = handshake.tick + LATENCY_TICKS + 1
        clientSynced = true
      }
    })

    if (clientSynced) {
      if (!spawnTriggered && tick > 20) {
        g.recordCommand(clientWorld, player, FireCommand)
        spawnTriggered = true
      }
      sim.sendClientCommands()

      g.runSchedule(clientSchedule, clientWorld as g.World)

      const pulseEntities = clientWorld.index.entityToIndex.indices.filter(
        (e) =>
          g.getComponentValue(clientWorld, e as g.Entity, Pulse) !== undefined,
      )

      if (pulseEntities.length > 1) {
        console.log(`Double pulse detected at client tick ${clientWorld.tick}`)
        for (const e of pulseEntities) {
          const node = g.entityGraphGetEntityNode(
            clientWorld.graph,
            e as g.Entity,
          )
          console.log(
            `  Entity ${e}: domainId=${g.getDomainId(e as g.Entity)}, localId=${g.getLocalId(e as g.Entity)}, replicated=${node?.vec.elements.some((c: g.ComponentLike) => clientWorld.componentRegistry.getId(c) === g.Replicated.id)}`,
          )
        }
      }

      expect(pulseEntities.length).toBeLessThanOrEqual(1)
    }
  }
})

/**
 * Reproduction of the server-authoritative-canvas disappearing player bug.
 *
 * The canvas example adds a HistoryBuffer to the server AND streams Position
 * snapshots to the client – neither of which the tests above do.  After the
 * client receives the spawn transaction and then issues a single move command,
 * the player rectangle vanishes from the client view even though the server
 * continues to show it.
 */
test("canvas repro: client player persists after first command", () => {
  const LATENCY_TICKS = 6

  // Extra component used by the canvas example's render query
  const Color = g.defineComponent<number>("Color", {
    bytesPerElement: 4,
    encode: (val, writer) => writer.writeUint32(val),
    decode: (reader) => reader.readUint32(),
  })

  const canvasSchema = [...schema, Color]

  // ---- server (mirrors createServer in canvas example) ----
  const serverWorld = g.makeWorld({domainId: 0})

  g.addResource(
    serverWorld,
    g.ReplicationConfig({
      historyWindow: 64,
      snapshotComponents: [serverWorld.componentRegistry.getId(Position)],
    }),
  )
  // Canvas example adds HistoryBuffer to the server – this is the key
  // difference from the existing setupServer() helper.
  g.addResource(
    serverWorld,
    g.HistoryBuffer({
      checkpoints: [],
      undoLog: [],
      maxSize: 120,
      checkpointInterval: 1,
    }),
  )
  g.addResource(
    serverWorld,
    g.ReplicationStream({transactions: [], snapshots: []}),
  )
  g.addResource(serverWorld, g.CommandBuffer(new Map()))
  g.addResource(serverWorld, g.IncomingTransactions(new Map()))
  g.addResource(serverWorld, g.IncomingSnapshots(new Map()))

  const serverSchedule = g.makeSystemSchedule()
  g.addSystem(serverSchedule, replication.clearReplicationStream)
  g.addSystem(serverSchedule, reconciliation.applyRemoteTransactions)
  g.addSystem(serverSchedule, commands.spawnEphemeralCommands)
  g.addSystem(serverSchedule, movementSystem)
  g.addSystem(serverSchedule, commands.cleanupEphemeralCommands)
  g.addSystem(serverSchedule, replication.commitPendingMutations)
  g.addSystem(serverSchedule, replication.emitSnapshots)
  g.addSystem(serverSchedule, replication.advanceWorldTick)
  g.addSystem(serverSchedule, replication.pruneTemporalBuffers)

  // ---- spawn player on the server ----
  const player = g.spawn(
    serverWorld,
    Position({x: 125, y: 125}),
    Color(0),
    g.Replicated,
  )

  // ---- server runs first tick  ----
  // commitPendingMutations produces the spawn transaction;
  // emitSnapshots produces a Position snapshot.
  g.runSchedule(serverSchedule, serverWorld as g.World)

  // Grab the replication output before it is cleared next tick.
  const stream = g.getResource(serverWorld, g.ReplicationStream)!
  expect(stream.transactions.length).toBeGreaterThan(0)

  // Serialize → deserialize so the test exercises the real wire path.
  const spawnTxPackets: Uint8Array[] = stream.transactions.map((tx) => {
    const w = new g.ByteWriter()
    g.writeTransaction(w, tx, serverWorld.componentRegistry)
    return w.getBytes()
  })
  const snapshotPackets: Uint8Array[] = [...stream.snapshots]

  // ---- client (mirrors createClient in canvas example) ----
  const clientWorld = g.makeWorld({domainId: 1})

  const reconcileSchedule = g.makeSystemSchedule()
  g.addSystem(reconcileSchedule, commands.spawnEphemeralCommands)
  g.addSystem(reconcileSchedule, movementSystem)
  g.addSystem(reconcileSchedule, commands.cleanupEphemeralCommands)

  g.addResource(
    clientWorld,
    g.HistoryBuffer({
      checkpoints: [],
      undoLog: [],
      maxSize: 120,
      checkpointInterval: 1,
    }),
  )
  g.addResource(clientWorld, g.CommandBuffer(new Map()))
  g.addResource(clientWorld, g.InputBuffer(new Map()))
  g.addResource(clientWorld, g.IncomingTransactions(new Map()))
  g.addResource(clientWorld, g.IncomingSnapshots(new Map()))
  g.addResource(
    clientWorld,
    g.ReplicationConfig({
      historyWindow: 64,
      ghostCleanupWindow: 60,
      reconcileSchedule,
    }),
  )

  const clientSchedule = g.makeSystemSchedule()
  g.addSystem(clientSchedule, reconciliation.performRollback)
  g.addSystem(clientSchedule, reconciliation.cleanupGhosts)
  g.addSystem(clientSchedule, reconciliation.applyRemoteSnapshots)
  g.addSystem(clientSchedule, commands.spawnEphemeralCommands)
  g.addSystem(clientSchedule, movementSystem)
  g.addSystem(clientSchedule, reconciliation.applyRemoteTransactions)
  g.addSystem(clientSchedule, commands.cleanupEphemeralCommands)
  g.addSystem(clientSchedule, replication.commitPendingMutations)
  g.addSystem(clientSchedule, replication.advanceWorldTick)
  g.addSystem(clientSchedule, replication.pruneTemporalBuffers)

  // ---- simulate the handshake: client syncs its clock ----
  // Server is now at tick 1 (after one runSchedule with advanceWorldTick).
  const targetTick = serverWorld.tick + 15 + LATENCY_TICKS // matches canvas LAG_COMPENSATION_TICKS + latencyTicks
  g.setTick(clientWorld, targetTick)
  const history = g.getResource(clientWorld, g.HistoryBuffer)!
  g.pushCheckpoint(clientWorld, history) // empty-world snapshot, same as canvas

  // ---- deliver spawn transaction & snapshot to the client ----
  for (const packet of spawnTxPackets) {
    const reader = new g.ByteReader(packet)
    const header = g.readMessageHeader(reader)
    const transaction = g.readTransaction(
      reader,
      header.tick,
      serverWorld.componentRegistry,
    )
    g.receiveTransaction(clientWorld, transaction)
  }
  for (const packet of snapshotPackets) {
    const reader = new g.ByteReader(packet)
    const header = g.readMessageHeader(reader)
    const snapshot = g.readSnapshot(reader, header.tick)
    g.receiveSnapshot(clientWorld, snapshot)
  }

  // ---- let the client tick a few times so it processes the transaction ----
  for (let i = 0; i < 5; i++) {
    g.runSchedule(clientSchedule, clientWorld as g.World)
  }

  // Sanity: player must be present before we issue any command.
  const posBefore = g.getComponentValue(clientWorld, player, Position)
  const colorBefore = g.getComponentValue(clientWorld, player, Color)
  expect(posBefore).toBeDefined()
  expect(colorBefore).toBeDefined()
  expect(posBefore!.x).toBe(125)
  expect(posBefore!.y).toBe(125)

  // ---- client records a single move command ----
  g.recordCommand(clientWorld, player, MoveCommand({dx: 1, dy: 0}))

  // ---- run the client schedule that processes the command ----
  g.runSchedule(clientSchedule, clientWorld as g.World)

  // ---- THE KEY ASSERTION: position and color must still be readable ----
  const posAfterCmd = g.getComponentValue(clientWorld, player, Position)
  const colorAfterCmd = g.getComponentValue(clientWorld, player, Color)
  expect(posAfterCmd).toBeDefined()
  expect(colorAfterCmd).toBeDefined()

  // The movement system should have applied the command.
  expect(posAfterCmd!.x).toBe(125 + 1 * SPEED)
  expect(posAfterCmd!.y).toBe(125)

  // ---- run several more ticks – the entity must not vanish ----
  for (let i = 0; i < 20; i++) {
    g.runSchedule(clientSchedule, clientWorld as g.World)
    const pos = g.getComponentValue(clientWorld, player, Position)
    const color = g.getComponentValue(clientWorld, player, Color)
    expect(pos).toBeDefined()
    expect(color).toBeDefined()
  }
})

/**
 * Reproduction of the second disappearing player bug:
 * pressing Space (FireCommand) while holding a direction key (MoveCommand)
 * causes the player to vanish on the client.
 *
 * The pulseSpawnerSystem spawns a Replicated entity with PulseOf(player)
 * during the same tick that the movement system processes the MoveCommand.
 */
test("canvas repro: player persists with simultaneous move + fire", () => {
  const LATENCY_TICKS = 6

  const Color = g.defineComponent<number>("Color", {
    bytesPerElement: 4,
    encode: (val, writer) => writer.writeUint32(val),
    decode: (reader) => reader.readUint32(),
  })

  // pulseSystem: grows pulse, despawns when large
  const pulseSystem = g.defineSystem(
    (
      query: g.All<g.Entity, typeof Pulse>,
      update: g.Add<typeof Pulse>,
      doDespawn: g.Despawn,
    ) => {
      for (const [entity, size] of query) {
        const nextSize = (size as number) + 1.5
        if (nextSize > 40) {
          doDespawn(entity)
        } else {
          update(entity, nextSize)
        }
      }
    },
    {
      params: [{all: [{entity: true}, Pulse]}, g.Add(Pulse), g.Despawn()],
      name: "pulseSystem",
    },
  )

  const canvasSchema = [...schema, Color]

  function addLogicalSystems(schedule: g.SystemSchedule) {
    g.addSystem(schedule, movementSystem)
    g.addSystem(schedule, pulseSpawnerSystem)
    g.addSystem(schedule, pulseSystem)
    g.addSystem(schedule, attachedPulseSystem)
  }

  // ---- server ----
  const serverWorld = g.makeWorld({domainId: 0})

  g.addResource(
    serverWorld,
    g.ReplicationConfig({
      historyWindow: 64,
      snapshotComponents: [serverWorld.componentRegistry.getId(Position)],
    }),
  )
  g.addResource(
    serverWorld,
    g.HistoryBuffer({
      checkpoints: [],
      undoLog: [],
      maxSize: 120,
      checkpointInterval: 1,
    }),
  )
  g.addResource(
    serverWorld,
    g.ReplicationStream({transactions: [], snapshots: []}),
  )
  g.addResource(serverWorld, g.CommandBuffer(new Map()))
  g.addResource(serverWorld, g.IncomingTransactions(new Map()))
  g.addResource(serverWorld, g.IncomingSnapshots(new Map()))

  const serverSchedule = g.makeSystemSchedule()
  g.addSystem(serverSchedule, replication.clearReplicationStream)
  g.addSystem(serverSchedule, reconciliation.applyRemoteTransactions)
  g.addSystem(serverSchedule, commands.spawnEphemeralCommands)
  addLogicalSystems(serverSchedule)
  g.addSystem(serverSchedule, commands.cleanupEphemeralCommands)
  g.addSystem(serverSchedule, replication.commitPendingMutations)
  g.addSystem(serverSchedule, replication.emitSnapshots)
  g.addSystem(serverSchedule, replication.advanceWorldTick)
  g.addSystem(serverSchedule, replication.pruneTemporalBuffers)

  // spawn player on server
  const player = g.spawn(
    serverWorld,
    Position({x: 125, y: 125}),
    Color(0),
    g.Replicated,
  )

  // server first tick
  g.runSchedule(serverSchedule, serverWorld as g.World)

  const stream = g.getResource(serverWorld, g.ReplicationStream)!
  const spawnTxPackets: Uint8Array[] = stream.transactions.map((tx) => {
    const w = new g.ByteWriter()
    g.writeTransaction(w, tx, serverWorld.componentRegistry)
    return w.getBytes()
  })
  const snapshotPackets: Uint8Array[] = [...stream.snapshots]

  // ---- client ----
  const clientWorld = g.makeWorld({domainId: 1})

  const reconcileSchedule = g.makeSystemSchedule()
  g.addSystem(reconcileSchedule, commands.spawnEphemeralCommands)
  addLogicalSystems(reconcileSchedule)
  g.addSystem(reconcileSchedule, commands.cleanupEphemeralCommands)

  g.addResource(
    clientWorld,
    g.HistoryBuffer({
      checkpoints: [],
      undoLog: [],
      maxSize: 120,
      checkpointInterval: 1,
    }),
  )
  g.addResource(clientWorld, g.CommandBuffer(new Map()))
  g.addResource(clientWorld, g.InputBuffer(new Map()))
  g.addResource(clientWorld, g.IncomingTransactions(new Map()))
  g.addResource(clientWorld, g.IncomingSnapshots(new Map()))
  g.addResource(
    clientWorld,
    g.ReplicationConfig({
      historyWindow: 64,
      ghostCleanupWindow: 60,
      reconcileSchedule,
    }),
  )

  const clientSchedule = g.makeSystemSchedule()
  g.addSystem(clientSchedule, reconciliation.performRollback)
  g.addSystem(clientSchedule, reconciliation.cleanupGhosts)
  g.addSystem(clientSchedule, reconciliation.applyRemoteSnapshots)
  g.addSystem(clientSchedule, commands.spawnEphemeralCommands)
  addLogicalSystems(clientSchedule)
  g.addSystem(clientSchedule, reconciliation.applyRemoteTransactions)
  g.addSystem(clientSchedule, commands.cleanupEphemeralCommands)
  g.addSystem(clientSchedule, replication.commitPendingMutations)
  g.addSystem(clientSchedule, replication.advanceWorldTick)
  g.addSystem(clientSchedule, replication.pruneTemporalBuffers)

  // handshake
  const targetTick = serverWorld.tick + 15 + LATENCY_TICKS
  g.setTick(clientWorld, targetTick)
  const history = g.getResource(clientWorld, g.HistoryBuffer)!
  g.pushCheckpoint(clientWorld, history)

  // deliver spawn transaction + snapshot to client
  for (const packet of spawnTxPackets) {
    const reader = new g.ByteReader(packet)
    const header = g.readMessageHeader(reader)
    const transaction = g.readTransaction(
      reader,
      header.tick,
      serverWorld.componentRegistry,
    )
    g.receiveTransaction(clientWorld, transaction)
  }
  for (const packet of snapshotPackets) {
    const reader = new g.ByteReader(packet)
    const header = g.readMessageHeader(reader)
    const snapshot = g.readSnapshot(reader, header.tick)
    g.receiveSnapshot(clientWorld, snapshot)
  }

  // settle ticks
  for (let i = 0; i < 5; i++) {
    g.runSchedule(clientSchedule, clientWorld as g.World)
  }

  // Sanity: player must be present
  const posBefore = g.getComponentValue(clientWorld, player, Position)
  expect(posBefore).toBeDefined()
  expect(posBefore!.x).toBe(125)

  // ---- hold direction for a few ticks ----
  for (let i = 0; i < 3; i++) {
    g.recordCommand(clientWorld, player, MoveCommand({dx: 1, dy: 0}))
    g.runSchedule(clientSchedule, clientWorld as g.World)
  }

  const posAfterMove = g.getComponentValue(clientWorld, player, Position)
  expect(posAfterMove).toBeDefined()
  expect(posAfterMove!.x).toBe(125 + 3 * SPEED)

  // ---- move + fire in the same tick ----
  g.recordCommand(clientWorld, player, MoveCommand({dx: 1, dy: 0}))
  g.recordCommand(clientWorld, player, FireCommand)

  // Send commands to the server (like the canvas example)
  const cmdBuffer = g.getResource(clientWorld, g.CommandBuffer)!
  const cmdsThisTick = cmdBuffer.get(clientWorld.tick)
  if (cmdsThisTick && cmdsThisTick.length > 0) {
    const w = new g.ByteWriter()
    g.writeCommands(
      w,
      clientWorld.tick,
      cmdsThisTick,
      clientWorld.componentRegistry,
    )
    const cmdPacket = w.getBytes()
    const reader2 = new g.ByteReader(cmdPacket)
    const header2 = g.readMessageHeader(reader2)
    const commands = g.readCommands(reader2, serverWorld.componentRegistry)
    const targetServerTick = Math.max(serverWorld.tick, header2.tick)
    for (const cmd of commands) {
      g.recordCommand(
        serverWorld,
        cmd.target as g.Entity,
        cmd,
        targetServerTick,
        header2.tick,
      )
    }
  }

  g.runSchedule(clientSchedule, clientWorld as g.World)

  // Player must still exist after move + fire
  const posAfterFire = g.getComponentValue(clientWorld, player, Position)
  const colorAfterFire = g.getComponentValue(clientWorld, player, Color)
  expect(posAfterFire).toBeDefined()
  expect(colorAfterFire).toBeDefined()
  expect(posAfterFire!.x).toBe(125 + 4 * SPEED)

  // ---- simulate the real game loop: interleave server + client ticks ----
  // Collect server output after each tick and deliver with latency.
  type DelayedPacket = {deliveryTick: number; packet: Uint8Array}
  const pendingToClient: DelayedPacket[] = []

  function collectServerOutput() {
    const s = g.getResource(serverWorld, g.ReplicationStream)!
    for (const tx of s.transactions) {
      const w = new g.ByteWriter()
      g.writeTransaction(w, tx, serverWorld.componentRegistry)
      pendingToClient.push({
        deliveryTick: clientWorld.tick + LATENCY_TICKS,
        packet: w.getBytes(),
      })
    }
    for (const raw of s.snapshots) {
      pendingToClient.push({
        deliveryTick: clientWorld.tick + LATENCY_TICKS,
        packet: raw,
      })
    }
  }

  function deliverPendingToClient() {
    const toDeliver = pendingToClient.filter(
      (p) => p.deliveryTick <= clientWorld.tick,
    )
    for (const p of toDeliver) {
      const reader3 = new g.ByteReader(p.packet)
      const header3 = g.readMessageHeader(reader3)
      if (header3.type === g.MessageType.Transaction) {
        const transaction = g.readTransaction(
          reader3,
          header3.tick,
          clientWorld.componentRegistry,
        )
        g.receiveTransaction(clientWorld, transaction)
      } else if (header3.type === g.MessageType.Snapshot) {
        const snapshot = g.readSnapshot(reader3, header3.tick)
        g.receiveSnapshot(clientWorld, snapshot)
      }
    }
    // Remove delivered packets
    for (let i = pendingToClient.length - 1; i >= 0; i--) {
      if (pendingToClient[i]!.deliveryTick <= clientWorld.tick) {
        pendingToClient.splice(i, 1)
      }
    }
  }

  // Advance server to catch up (it's behind from the initial setup)
  while (serverWorld.tick < clientWorld.tick - LATENCY_TICKS) {
    g.runSchedule(serverSchedule, serverWorld as g.World)
    collectServerOutput()
  }

  // Run 40 more ticks with continuous movement, firing every once in a while
  for (let i = 0; i < 40; i++) {
    // Server tick
    g.runSchedule(serverSchedule, serverWorld as g.World)
    collectServerOutput()

    // Deliver any pending server output that has "arrived"
    deliverPendingToClient()

    // Client input: always move, fire on specific ticks
    g.recordCommand(clientWorld, player, MoveCommand({dx: 1, dy: 0}))
    if (i % 10 === 0) {
      g.recordCommand(clientWorld, player, FireCommand)
    }

    // Send commands to server
    const cb = g.getResource(clientWorld, g.CommandBuffer)!
    const tickCmds = cb.get(clientWorld.tick)
    if (tickCmds && tickCmds.length > 0) {
      const w = new g.ByteWriter()
      g.writeCommands(
        w,
        clientWorld.tick,
        tickCmds,
        clientWorld.componentRegistry,
      )
      const cmdPacket = w.getBytes()
      const r = new g.ByteReader(cmdPacket)
      const h = g.readMessageHeader(r)
      const cmds = g.readCommands(r, serverWorld.componentRegistry)
      const tgt = Math.max(serverWorld.tick, h.tick)
      for (const cmd of cmds) {
        g.recordCommand(serverWorld, cmd.target as g.Entity, cmd, tgt, h.tick)
      }
    }

    // Client tick
    g.runSchedule(clientSchedule, clientWorld as g.World)

    // Assert player survives every tick
    const pos = g.getComponentValue(clientWorld, player, Position)
    const color = g.getComponentValue(clientWorld, player, Color)
    expect(pos).toBeDefined()
    expect(color).toBeDefined()
  }
})

/**
 * Reproduction of the ghost cleanup + entity ID recycling bug.
 *
 * When a predicted Replicated entity (pulse) is despawned by game logic, its
 * entity ID is recycled. A subsequent predicted entity can reuse the same ID.
 * But the OLD transient registry entry still exists, and when ghost cleanup
 * eventually fires for that entry, it despawns the WRONG (new) entity.
 *
 * Pressing Space repeatedly causes pulse entities to cycle through creation
 * and destruction. After a few cycles, ghost cleanup despawns a live pulse
 * entity (or worse, a player entity that shares a recycled ID).
 */
test("canvas repro: ghost cleanup must not despawn recycled entity IDs", () => {
  const LATENCY_TICKS = 6
  const GHOST_WINDOW = 60

  const Color = g.defineComponent<number>("Color", {
    bytesPerElement: 4,
    encode: (val, writer) => writer.writeUint32(val),
    decode: (reader) => reader.readUint32(),
  })

  const pulseSystem = g.defineSystem(
    (
      query: g.All<g.Entity, typeof Pulse>,
      update: g.Add<typeof Pulse>,
      doDespawn: g.Despawn,
    ) => {
      for (const [entity, size] of query) {
        const nextSize = (size as number) + 1.5
        if (nextSize > 40) {
          doDespawn(entity)
        } else {
          update(entity, nextSize)
        }
      }
    },
    {
      params: [{all: [{entity: true}, Pulse]}, g.Add(Pulse), g.Despawn()],
      name: "pulseSystem",
    },
  )

  const canvasSchema = [...schema, Color]

  function addLogicalSystems(schedule: g.SystemSchedule) {
    g.addSystem(schedule, movementSystem)
    g.addSystem(schedule, pulseSpawnerSystem)
    g.addSystem(schedule, pulseSystem)
    g.addSystem(schedule, attachedPulseSystem)
  }

  // ---- server ----
  const serverWorld = g.makeWorld({domainId: 0})
  g.addResource(
    serverWorld,
    g.ReplicationConfig({
      historyWindow: 64,
      snapshotComponents: [serverWorld.componentRegistry.getId(Position)],
    }),
  )
  g.addResource(
    serverWorld,
    g.HistoryBuffer({
      checkpoints: [],
      undoLog: [],
      maxSize: 120,
      checkpointInterval: 1,
    }),
  )
  g.addResource(
    serverWorld,
    g.ReplicationStream({transactions: [], snapshots: []}),
  )
  g.addResource(serverWorld, g.CommandBuffer(new Map()))
  g.addResource(serverWorld, g.IncomingTransactions(new Map()))
  g.addResource(serverWorld, g.IncomingSnapshots(new Map()))

  const serverSchedule = g.makeSystemSchedule()
  g.addSystem(serverSchedule, replication.clearReplicationStream)
  g.addSystem(serverSchedule, reconciliation.applyRemoteTransactions)
  g.addSystem(serverSchedule, commands.spawnEphemeralCommands)
  addLogicalSystems(serverSchedule)
  g.addSystem(serverSchedule, commands.cleanupEphemeralCommands)
  g.addSystem(serverSchedule, replication.commitPendingMutations)
  g.addSystem(serverSchedule, replication.emitSnapshots)
  g.addSystem(serverSchedule, replication.advanceWorldTick)
  g.addSystem(serverSchedule, replication.pruneTemporalBuffers)

  const player = g.spawn(
    serverWorld,
    Position({x: 125, y: 125}),
    Color(0),
    g.Replicated,
  )
  g.runSchedule(serverSchedule, serverWorld as g.World)

  const stream = g.getResource(serverWorld, g.ReplicationStream)!
  const spawnTxPackets = stream.transactions.map((tx) => {
    const w = new g.ByteWriter()
    g.writeTransaction(w, tx, serverWorld.componentRegistry)
    return w.getBytes()
  })
  const snapshotPackets = [...stream.snapshots]

  // ---- client ----
  const clientWorld = g.makeWorld({domainId: 1})
  const reconcileSchedule = g.makeSystemSchedule()
  g.addSystem(reconcileSchedule, commands.spawnEphemeralCommands)
  addLogicalSystems(reconcileSchedule)
  g.addSystem(reconcileSchedule, commands.cleanupEphemeralCommands)

  g.addResource(
    clientWorld,
    g.HistoryBuffer({
      checkpoints: [],
      undoLog: [],
      maxSize: 120,
      checkpointInterval: 1,
    }),
  )
  g.addResource(clientWorld, g.CommandBuffer(new Map()))
  g.addResource(clientWorld, g.InputBuffer(new Map()))
  g.addResource(clientWorld, g.IncomingTransactions(new Map()))
  g.addResource(clientWorld, g.IncomingSnapshots(new Map()))
  g.addResource(
    clientWorld,
    g.ReplicationConfig({
      historyWindow: 64,
      ghostCleanupWindow: GHOST_WINDOW,
      reconcileSchedule,
    }),
  )

  const clientSchedule = g.makeSystemSchedule()
  g.addSystem(clientSchedule, reconciliation.performRollback)
  g.addSystem(clientSchedule, reconciliation.cleanupGhosts)
  g.addSystem(clientSchedule, reconciliation.applyRemoteSnapshots)
  g.addSystem(clientSchedule, commands.spawnEphemeralCommands)
  addLogicalSystems(clientSchedule)
  g.addSystem(clientSchedule, reconciliation.applyRemoteTransactions)
  g.addSystem(clientSchedule, commands.cleanupEphemeralCommands)
  g.addSystem(clientSchedule, replication.commitPendingMutations)
  g.addSystem(clientSchedule, replication.advanceWorldTick)
  g.addSystem(clientSchedule, replication.pruneTemporalBuffers)

  // ---- handshake ----
  const targetTick = serverWorld.tick + 15 + LATENCY_TICKS
  g.setTick(clientWorld, targetTick)
  const history = g.getResource(clientWorld, g.HistoryBuffer)!
  g.pushCheckpoint(clientWorld, history)

  for (const packet of spawnTxPackets) {
    const reader = new g.ByteReader(packet)
    const header = g.readMessageHeader(reader)
    const transaction = g.readTransaction(
      reader,
      header.tick,
      serverWorld.componentRegistry,
    )
    g.receiveTransaction(clientWorld, transaction)
  }
  for (const packet of snapshotPackets) {
    const reader = new g.ByteReader(packet)
    const header = g.readMessageHeader(reader)
    const snapshot = g.readSnapshot(reader, header.tick)
    g.receiveSnapshot(clientWorld, snapshot)
  }

  // settle
  for (let i = 0; i < 5; i++) {
    g.runSchedule(clientSchedule, clientWorld as g.World)
  }
  expect(g.getComponentValue(clientWorld, player, Position)).toBeDefined()

  // ---- fire repeatedly, well past the ghost cleanup window ----
  // The pulse entity lives ~23 ticks (size 5 → 40 @ +1.5/tick).
  // Fire every 30 ticks so the old pulse is despawned before the new one.
  // After GHOST_WINDOW + extra ticks, ghost cleanup should fire for old entries.
  const FIRE_INTERVAL = 30
  const TOTAL_TICKS = GHOST_WINDOW + FIRE_INTERVAL * 3 + 20

  // Intercept console.log to detect ghost cleanup incorrectly despawning
  // recycled entity IDs.
  const originalLog = console.log
  const ghostDespawns: number[] = []
  console.log = (...args: unknown[]) => {
    if (args[0] === "despawned transient entity") {
      ghostDespawns.push(args[1] as number)
    }
  }

  try {
    for (let i = 0; i < TOTAL_TICKS; i++) {
      // Fire command every FIRE_INTERVAL ticks
      if (i % FIRE_INTERVAL === 0) {
        g.recordCommand(clientWorld, player, FireCommand)
      }

      g.runSchedule(clientSchedule, clientWorld as g.World)

      // The player must ALWAYS survive
      const pos = g.getComponentValue(clientWorld, player, Position)
      const color = g.getComponentValue(clientWorld, player, Color)
      expect(pos).toBeDefined()
      expect(color).toBeDefined()
    }

    // Ghost cleanup should NEVER despawn an entity whose transient registry
    // entry was already cleaned up by flushDeletions.  If it does, stale
    // entries collided with recycled IDs.
    expect(ghostDespawns).toEqual([])
  } finally {
    console.log = originalLog
  }
})
