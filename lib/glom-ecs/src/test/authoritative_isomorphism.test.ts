import {expect, test} from "bun:test"
import * as commands from "../command"
import * as g from "../index"
import * as reconciliation from "../reconciliation"
import * as replication from "../replication"

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

const SPEED = 2

const movementSystem = g.defineSystem(
  (
    query: g.All<
      g.Entity,
      g.Read<typeof Position>,
      g.Rel<typeof g.CommandOf, g.Read<typeof MoveCommand>>
    >,
    update: g.Add<typeof Position>,
  ) => {
    for (const [entity, pos, move] of query) {
      update(entity, {
        x: (pos as any).x + (move as any).dx * SPEED,
        y: (pos as any).y + (move as any).dy * SPEED,
      })
    }
  },
  {
    params: [
      {
        all: [
          {entity: true},
          {read: Position},
          {rel: [g.CommandOf, {read: MoveCommand}]},
        ],
      } as any,
      {add: Position} as any,
    ],
    name: "movementSystem",
  },
)

const pulseSpawnerSystem = g.defineSystem(
  (
    query: g.All<
      g.Entity,
      g.Read<typeof Position>,
      g.Rel<typeof g.CommandOf, g.Has<typeof FireCommand>>
    >,
    world: g.World,
  ) => {
    for (const [playerEnt, pos] of query) {
      let intentTick = world.tick
      const node = g.sparseMapGet(
        world.entityGraph.byEntity,
        playerEnt as number,
      )
      if (node) {
        for (const comp of node.vec.elements) {
          const compId = world.componentRegistry.getId(comp)
          const rel = world.relations.virtualToRel.get(compId)
          if (
            rel &&
            rel.relationId === world.componentRegistry.getId(g.CommandOf)
          ) {
            const cmdEnt = rel.object as g.Entity
            const cmdNode = g.sparseMapGet(
              world.entityGraph.byEntity,
              cmdEnt as number,
            )
            const fireCommandId = world.componentRegistry.getId(FireCommand)
            if (
              cmdNode?.vec.elements.some(
                (c) => world.componentRegistry.getId(c) === fireCommandId,
              )
            ) {
              const it = g.getComponentValue(world, cmdEnt, g.IntentTick)
              if (it !== undefined) {
                intentTick = it
                break
              }
            }
          }
        }
      }

      g.spawn(
        world,
        [
          Position({...pos} as any),
          Pulse(5),
          PulseOf(playerEnt),
          g.Replicated,
        ],
        world.registry.domainId,
        intentTick,
      )
    }
  },
  {
    params: [
      {
        all: [
          {entity: true},
          {read: Position},
          {rel: [g.CommandOf, {has: FireCommand}]},
        ],
      } as any,
      {world: true} as any,
    ],
    name: "pulseSpawnerSystem",
  },
)

const attachedPulseSystem = g.defineSystem(
  (
    pulses: g.All<
      g.Entity,
      g.Read<typeof Position>,
      g.Rel<typeof PulseOf, g.Read<typeof Position>>
    >,
    update: g.Add<typeof Position>,
  ) => {
    for (const [pulseEnt, _pos, parentPos] of pulses) {
      update(pulseEnt, {
        x: (parentPos as any).x,
        y: (parentPos as any).y,
      })
    }
  },
  {
    params: [
      {
        all: [
          {entity: true},
          {read: Position},
          {rel: [PulseOf, {read: Position}]},
        ],
      } as any,
      {add: Position} as any,
    ],
    name: "attachedPulseSystem",
  },
)

const schema = [Position, MoveCommand, FireCommand, Pulse, PulseOf]

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
      simulationSchedule: reconcileSchedule,
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

test("rigorous straight-line movement isomorphism", () => {
  const server = setupServer()
  const client = setupClient(1)
  const clientToServer = new MockPipe()
  const serverToClient = new MockPipe()
  const LATENCY_TICKS = 5

  const player = g.spawn(server.world, [Position({x: 0, y: 0}), g.Replicated])

  const handshakeWriter = new g.ByteWriter()
  g.writeHandshakeServer(handshakeWriter, server.world.tick, {
    domainId: 0,
    tick: server.world.tick,
  })
  serverToClient.send(handshakeWriter.getBytes(), 0, LATENCY_TICKS)

  let clientSynced = false
  const serverPositions: Map<number, {x: number; y: number}> = new Map()
  const predictedPositions: Map<number, {x: number; y: number}> = new Map()

  for (let tick = 0; tick < 200; tick++) {
    for (const packet of clientToServer.receive(server.world.tick)) {
      const reader = new g.ByteReader(packet)
      const header = g.readMessageHeader(reader)
      if (header.type === g.MessageType.Command) {
        const cmdMsg = g.readCommands(reader, header.tick, server.world)
        const targetTick = Math.max(server.world.tick, cmdMsg.tick)
        for (const cmd of cmdMsg.commands) {
          g.recordCommand(
            server.world,
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

    const sPosBefore = g.getComponentValue(server.world, player, Position)
    if (sPosBefore) {
      serverPositions.set(server.world.tick, {...sPosBefore})
    }

    g.runSchedule(server.schedule, server.world as g.World)

    const stream = g.getResource(server.world, g.ReplicationStream)
    if (stream) {
      for (const transaction of stream.transactions) {
        const writer = new g.ByteWriter()
        g.writeTransaction(writer, transaction, server.world)
        serverToClient.send(
          writer.getBytes(),
          server.world.tick,
          LATENCY_TICKS,
        )
      }
      for (const snap of stream.snapshots) {
        const writer = new g.ByteWriter()
        g.writeSnapshot(writer, snap, server.world)
        serverToClient.send(
          writer.getBytes(),
          server.world.tick,
          LATENCY_TICKS,
        )
      }
      stream.transactions.length = 0
      stream.snapshots.length = 0
    }

    for (const packet of serverToClient.receive(tick)) {
      const reader = new g.ByteReader(packet)
      const header = g.readMessageHeader(reader)
      if (header.type === g.MessageType.Handshake) {
        const handshake = g.readHandshakeServer(reader)
        if (!clientSynced) {
          client.world.tick = handshake.tick + LATENCY_TICKS * 3

          const history = g.getResource(client.world, g.HistoryBuffer)
          if (history) {
            g.pushSnapshot(client.world, history)
          }
          clientSynced = true
        }
      } else if (header.type === g.MessageType.Transaction) {
        const transaction = g.readTransaction(
          reader,
          header.tick,
          server.world,
        )
        g.receiveTransaction(client.world, transaction)
      }
    }

    if (clientSynced) {
      g.recordCommand(client.world, player, MoveCommand({dx: 1, dy: 0}))

      const commandBuffer = g.getResource(client.world, g.CommandBuffer)
      const commands = commandBuffer?.get(client.world.tick)
      if (commands) {
        const writer = new g.ByteWriter()
        g.writeCommands(
          writer,
          {tick: client.world.tick, commands},
          server.world,
        )
        clientToServer.send(writer.getBytes(), tick, LATENCY_TICKS)
      }

      const cPosBefore = g.getComponentValue(client.world, player, Position)
      if (cPosBefore) {
        predictedPositions.set(client.world.tick, {...cPosBefore})
      }

      g.runSchedule(client.schedule, client.world as g.World)

      const checkTick = tick - LATENCY_TICKS
      if (checkTick >= 0) {
        const sPos = serverPositions.get(checkTick)

        const history = g.getResource(client.world, g.HistoryBuffer)
        const snapshot = history?.snapshots.find((s) => s.tick === checkTick)

        if (sPos && snapshot) {
          const playerIdx = snapshot.entityToIndex.get(player)
          const posStore = snapshot.componentData.get(
            client.world.componentRegistry.getId(Position),
          )
          if (playerIdx !== undefined && posStore) {
            const reconciledPos = posStore[playerIdx] as {
              x: number
              y: number
            }
            expect(reconciledPos.x).toBeCloseTo(sPos.x)
            expect(reconciledPos.y).toBeCloseTo(sPos.y)
          }
        }
      }
    }
  }
})

test("stop-and-go movement isomorphism", () => {
  const server = setupServer()
  const client = setupClient(1)
  const clientToServer = new MockPipe()
  const serverToClient = new MockPipe()
  const LATENCY_TICKS = 5

  const player = g.spawn(server.world, [Position({x: 0, y: 0}), g.Replicated])

  const handshakeWriter = new g.ByteWriter()
  g.writeHandshakeServer(handshakeWriter, server.world.tick, {
    domainId: 0,
    tick: server.world.tick,
  })
  serverToClient.send(handshakeWriter.getBytes(), 0, LATENCY_TICKS)

  let clientSynced = false
  const serverPositions: Map<number, {x: number; y: number}> = new Map()
  const predictedPositions: Map<number, {x: number; y: number}> = new Map()

  for (let tick = 0; tick < 200; tick++) {
    for (const packet of clientToServer.receive(server.world.tick)) {
      const reader = new g.ByteReader(packet)
      const header = g.readMessageHeader(reader)
      if (header.type === g.MessageType.Command) {
        const cmdMsg = g.readCommands(reader, header.tick, server.world)
        const targetTick = Math.max(server.world.tick, cmdMsg.tick)
        for (const cmd of cmdMsg.commands) {
          g.recordCommand(
            server.world,
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
    const sPosBefore = g.getComponentValue(server.world, player, Position)
    if (sPosBefore) {
      serverPositions.set(server.world.tick, {...sPosBefore})
    }
    g.runSchedule(server.schedule, server.world as g.World)

    const stream = g.getResource(server.world, g.ReplicationStream)
    if (stream) {
      for (const transaction of stream.transactions) {
        const writer = new g.ByteWriter()
        g.writeTransaction(writer, transaction, server.world)
        serverToClient.send(
          writer.getBytes(),
          server.world.tick,
          LATENCY_TICKS,
        )
      }
      for (const snap of stream.snapshots) {
        const writer = new g.ByteWriter()
        g.writeSnapshot(writer, snap, server.world)
        serverToClient.send(
          writer.getBytes(),
          server.world.tick,
          LATENCY_TICKS,
        )
      }
      stream.transactions.length = 0
      stream.snapshots.length = 0
    }

    for (const packet of serverToClient.receive(tick)) {
      const reader = new g.ByteReader(packet)
      const header = g.readMessageHeader(reader)
      if (header.type === g.MessageType.Handshake) {
        const handshake = g.readHandshakeServer(reader)
        if (!clientSynced) {
          client.world.tick = handshake.tick + LATENCY_TICKS * 3
          clientSynced = true
        }
      } else if (header.type === g.MessageType.Transaction) {
        const transaction = g.readTransaction(
          reader,
          header.tick,
          server.world,
        )
        g.receiveTransaction(client.world, transaction)
      }
    }

    if (clientSynced) {
      if (tick >= 50 && tick < 100) {
        g.recordCommand(client.world, player, MoveCommand({dx: 1, dy: 0}))
      }

      const commandBuffer = g.getResource(client.world, g.CommandBuffer)
      const commands = commandBuffer?.get(client.world.tick)
      if (commands) {
        const writer = new g.ByteWriter()
        g.writeCommands(
          writer,
          {tick: client.world.tick, commands},
          server.world,
        )
        clientToServer.send(writer.getBytes(), tick, LATENCY_TICKS)
      }

      const cPosBefore = g.getComponentValue(client.world, player, Position)
      if (cPosBefore) {
        predictedPositions.set(client.world.tick, {...cPosBefore})
      }

      g.runSchedule(client.schedule, client.world as g.World)

      const checkTick = tick - LATENCY_TICKS
      if (checkTick >= 0) {
        const sPos = serverPositions.get(checkTick)

        const history = g.getResource(client.world, g.HistoryBuffer)
        const snapshot = history?.snapshots.find((s) => s.tick === checkTick)

        if (sPos && snapshot) {
          const playerIdx = snapshot.entityToIndex.get(player)
          const posStore = snapshot.componentData.get(
            client.world.componentRegistry.getId(Position),
          )
          if (playerIdx !== undefined && posStore) {
            const reconciledPos = posStore[playerIdx] as {
              x: number
              y: number
            }
            expect(reconciledPos.x).toBeCloseTo(sPos.x)
            expect(reconciledPos.y).toBeCloseTo(sPos.y)
          }
        }
      }
    }
  }
})

test("predictive spawning and rebinding isomorphism", () => {
  const server = setupServer()
  const client = setupClient(1)
  const clientToServer = new MockPipe()
  const serverToClient = new MockPipe()
  const LATENCY_TICKS = 5

  const player = g.spawn(server.world, [Position({x: 0, y: 0}), g.Replicated])

  const handshakeWriter = new g.ByteWriter()
  g.writeHandshakeServer(handshakeWriter, server.world.tick, {
    domainId: 0,
    tick: server.world.tick,
  })
  serverToClient.send(
    handshakeWriter.getBytes(),
    server.world.tick,
    LATENCY_TICKS,
  )

  let clientSynced = false
  let spawnTriggered = false

  for (let tick = 0; tick < 100; tick++) {
    for (const packet of clientToServer.receive(server.world.tick)) {
      const reader = new g.ByteReader(packet)
      const header = g.readMessageHeader(reader)
      if (header.type === g.MessageType.Command) {
        const cmdMsg = g.readCommands(reader, header.tick, server.world)
        const targetTick = Math.max(server.world.tick, cmdMsg.tick)
        for (const cmd of cmdMsg.commands) {
          g.recordCommand(
            server.world,
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
    g.runSchedule(server.schedule, server.world as g.World)

    const stream = g.getResource(server.world, g.ReplicationStream)
    if (stream) {
      for (const transaction of stream.transactions) {
        const writer = new g.ByteWriter()
        g.writeTransaction(writer, transaction, server.world)
        serverToClient.send(
          writer.getBytes(),
          server.world.tick,
          LATENCY_TICKS,
        )
      }
      for (const snap of stream.snapshots) {
        const writer = new g.ByteWriter()
        g.writeSnapshot(writer, snap, server.world)
        serverToClient.send(
          writer.getBytes(),
          server.world.tick,
          LATENCY_TICKS,
        )
      }
      stream.transactions.length = 0
      stream.snapshots.length = 0
    }

    for (const packet of serverToClient.receive(tick)) {
      const reader = new g.ByteReader(packet)
      const header = g.readMessageHeader(reader)
      if (header.type === g.MessageType.Handshake) {
        const handshake = g.readHandshakeServer(reader)
        if (!clientSynced) {
          client.world.tick = handshake.tick + LATENCY_TICKS + 1
          clientSynced = true
        }
      } else if (header.type === g.MessageType.Transaction) {
        const transaction = g.readTransaction(
          reader,
          header.tick,
          server.world,
        )
        g.receiveTransaction(client.world, transaction)
      }
    }

    if (clientSynced) {
      if (!spawnTriggered && tick > 20) {
        g.recordCommand(client.world, player, FireCommand)
        spawnTriggered = true
      }

      const commandBuffer = g.getResource(client.world, g.CommandBuffer)
      const commands = commandBuffer?.get(client.world.tick)
      if (commands) {
        const writer = new g.ByteWriter()
        g.writeCommands(
          writer,
          {tick: client.world.tick, commands},
          server.world,
        )
        clientToServer.send(
          writer.getBytes(),
          client.world.tick,
          LATENCY_TICKS,
        )
      }

      g.runSchedule(client.schedule, client.world as g.World)

      const pulseEntities = client.world.index.entityToIndex.indices.filter(
        (e) => {
          return (
            g.getComponentValue(client.world, e as g.Entity, Pulse) !==
            undefined
          )
        },
      )

      if (pulseEntities.length > 1) {
        console.log(`Double pulse detected at client tick ${client.world.tick}`)
        for (const e of pulseEntities) {
          const node = g.sparseMapGet(
            client.world.entityGraph.byEntity,
            e as number,
          )
          console.log(
            `  Entity ${e}: domainId=${g.getDomainId(e as g.Entity)}, localId=${g.getLocalId(e as g.Entity)}, replicated=${node?.vec.elements.some((c) => client.world.componentRegistry.getId(c) === g.Replicated.id)}`,
          )
        }
      }

      expect(pulseEntities.length).toBeLessThanOrEqual(1)
    }
  }
})
