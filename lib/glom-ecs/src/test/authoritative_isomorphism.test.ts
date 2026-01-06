import {expect, test} from "bun:test"
import * as commands from "../command"
import * as g from "../index"
import * as reconciliation from "../reconciliation"
import * as replication from "../replication"

// --- SCHEMA & SYSTEMS ---

const Position = g.defineComponent<{x: number; y: number}>({
  bytesPerElement: 16,
  encode: (val, writer) => {
    writer.writeFloat64(val.x)
    writer.writeFloat64(val.y)
  },
  decode: (reader) => {
    return {x: reader.readFloat64(), y: reader.readFloat64()}
  },
})

const MoveCommand = g.defineComponent<{dx: number; dy: number}>({
  bytesPerElement: 16,
  encode: (val, writer) => {
    writer.writeFloat64(val.dx)
    writer.writeFloat64(val.dy)
  },
  decode: (reader) => {
    return {dx: reader.readFloat64(), dy: reader.readFloat64()}
  },
})

const FireCommand = g.defineTag()

const Pulse = g.defineComponent<number>({
  bytesPerElement: 8,
  encode: (val, writer) => {
    writer.writeFloat64(val)
  },
  decode: (reader) => {
    return reader.readFloat64()
  },
})

const PulseOf = g.defineRelation()

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
        join: [
          {all: [{entity: true}, Position]},
          {all: [Position]},
          PulseOf,
        ],
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
  const world = g.makeWorld({domainId: 0, schema})
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
  const world = g.makeWorld({domainId, schema})
  g.addResource(world, g.HistoryBuffer({snapshots: [], maxSize: 120}))
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
        const cmdMsg = g.readCommands(reader, header.tick, this.server.world)
        const targetTick = Math.max(this.server.world.tick, cmdMsg.tick)
        for (const cmd of cmdMsg.commands) {
          g.recordCommand(
            this.server.world,
            cmd.target as g.Entity,
            {
              component: {
                id: cmd.componentId,
                __component_brand: true,
              } as g.Component<unknown>,
              value: cmd.data,
            },
            targetTick,
            cmdMsg.tick,
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
          this.server.world,
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
        g.writeTransaction(writer, transaction, this.server.world)
        this.serverToClient.send(
          writer.getBytes(),
          this.server.world.tick,
          this.latencyTicks,
        )
      }
      for (const snap of stream.snapshots) {
        const writer = new g.ByteWriter()
        g.writeSnapshot(writer, snap, this.server.world)
        this.serverToClient.send(
          writer.getBytes(),
          this.server.world.tick,
          this.latencyTicks,
        )
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
        {tick: this.client.world.tick, commands},
        this.server.world,
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
        if (history) g.pushSnapshot(clientWorld, history)
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
        const snapshot = history?.snapshots.find((s) => s.tick === checkTick)

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
        const snapshot = history?.snapshots.find((s) => s.tick === checkTick)

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
            clientWorld.entityGraph,
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
