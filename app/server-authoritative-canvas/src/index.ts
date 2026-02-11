import {createDevtools} from "@glom/devtools"
import {
  type Add,
  // Query types
  type All,
  // Protocol / binary
  acquireWriter,
  advanceWorldTick,
  // Reconciliation
  applyRemoteTransactions,
  ByteReader,
  Command,
  Component,
  cleanupGhosts,
  clearReplicationStream,
  commitPendingMutations,
  type Despawn,
  type Entity,
  emitSnapshots,
  History,
  IncomingSnapshots,
  IncomingTransactions,
  type Join,
  MessageType,
  performRollback,
  pruneTemporalBuffers,
  Relation,
  // Replication
  Replicated,
  ReplicationConfig,
  ReplicationStream,
  readCommands,
  readHandshakeServer,
  readMessageType,
  readSnapshot,
  readTransaction,
  receiveSnapshot,
  receiveTransaction,
  SystemSchedule,
  Timestep,
  World,
  type Write,
  writeCommands,
  writeHandshakeServer,
  writeTransaction,
} from "@glom/ecs"
import * as commands from "@glom/ecs/command"

const Position = Component.define<{x: number; y: number}>("Position")

const Color = Component.define<number>("Color", {
  bytesPerElement: 4,
  encode: (val, writer) => {
    writer.writeUint32(val)
  },
  decode: (reader) => {
    return reader.readUint32()
  },
})

const MoveCommand = Component.define<{dx: number; dy: number}>("MoveCommand")

const Pulse = Component.define<number>("Pulse")

const FireCommand = Component.defineTag("FireCommand")
const PulseOf = Relation.define("PulseOf")
const CanvasContext =
  Component.define<CanvasRenderingContext2D>("CanvasContext")

const SPEED = 2
const LATENCY_MS = 100
const HZ = 60
const LAG_COMPENSATION_TICKS = 15

function addLogicalSystems(schedule: SystemSchedule.SystemSchedule) {
  SystemSchedule.add(schedule, movementSystem)
  SystemSchedule.add(schedule, pulseSpawnerSystem)
  SystemSchedule.add(schedule, pulseSystem)
  SystemSchedule.add(schedule, attachedPulseSystem)
}

function movementSystem(
  query: Join<
    All<Write<typeof Position>>,
    All<typeof MoveCommand>,
    typeof Command.CommandOf
  >,
) {
  for (const [pos, move] of query) {
    pos.x += move.dx * SPEED
    pos.y += move.dy * SPEED

    if (pos.x < 0) pos.x = 250
    if (pos.x > 250) pos.x = 0
    if (pos.y < 0) pos.y = 250
    if (pos.y > 250) pos.y = 0
  }
}

function pulseSpawnerSystem(
  query: Join<
    All<Entity.Entity, typeof Position>,
    All<typeof Command.IntentTick, typeof FireCommand>,
    typeof Command.CommandOf
  >,
  world: World.World,
) {
  for (const [player, pos, tick] of query) {
    World.spawnInDomain(
      world,
      [Position({...pos}), Pulse(5), PulseOf(player), Replicated],
      undefined,
      tick,
    )
  }
}

function pulseSystem(
  query: All<Entity.Entity, typeof Pulse>,
  update: Add<typeof Pulse>,
  despawn: Despawn,
) {
  for (const [entity, size] of query) {
    const nextSize = (size as number) + 1.5
    if (nextSize > 40) {
      despawn(entity)
    } else {
      update(entity, nextSize)
    }
  }
}

function attachedPulseSystem(
  pulses: Join<
    All<Write<typeof Position>>,
    All<typeof Position>,
    typeof PulseOf
  >,
) {
  for (const [pos, parentPos] of pulses) {
    pos.x = parentPos.x
    pos.y = parentPos.y
  }
}

function renderSystem(
  query: All<typeof Position, typeof Color>,
  pulses: All<typeof Position, typeof Pulse>,
  ctx: Write<typeof CanvasContext>,
) {
  ctx.fillStyle = "#0f0f0f" // --bg
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)

  for (const [pos, color] of query) {
    ctx.fillStyle = (color as number) === 0 ? "#aed7f5" : "#d6d4a6"
    ctx.fillRect(pos.x - 10, pos.y - 10, 20, 20)
  }

  ctx.strokeStyle = "#fda293"
  ctx.lineWidth = 2
  for (const [pos, size] of pulses) {
    ctx.beginPath()
    ctx.arc(pos.x, pos.y, size as number, 0, Math.PI * 2)
    ctx.stroke()
  }
}

function createServer() {
  const canvas = document.getElementById("canvasServer") as HTMLCanvasElement
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D
  const world = World.create({domainId: 0}) as World.World
  const schedule = SystemSchedule.create()
  const timestep = Timestep.create(HZ)

  World.addResource(world, CanvasContext(ctx))
  World.addResource(
    world,
    ReplicationConfig({
      historyWindow: 64,
      snapshotComponents: [world.componentRegistry.getId(Position)],
      snapshotInterval: 5,
    }),
  )
  World.addResource(world, ReplicationStream({transactions: [], snapshots: []}))
  World.addResource(world, Command.CommandBuffer(new Map()))
  World.addResource(world, IncomingTransactions(new Map()))
  World.addResource(world, IncomingSnapshots(new Map()))

  SystemSchedule.add(schedule, clearReplicationStream)
  SystemSchedule.add(schedule, applyRemoteTransactions)
  SystemSchedule.add(schedule, commands.spawnEphemeralCommands)
  addLogicalSystems(schedule)
  SystemSchedule.add(schedule, renderSystem)
  SystemSchedule.add(schedule, commands.cleanupEphemeralCommands)
  SystemSchedule.add(schedule, commitPendingMutations)
  SystemSchedule.add(schedule, emitSnapshots)
  SystemSchedule.add(schedule, advanceWorldTick)
  SystemSchedule.add(schedule, pruneTemporalBuffers)

  return {world, schedule, timestep}
}

function createClient(
  domainId: number,
  reconcileSchedule: SystemSchedule.SystemSchedule,
) {
  const canvas = document.getElementById("canvasClient") as HTMLCanvasElement
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D
  const world = World.create({domainId}) as World.World
  const timestep = Timestep.create(HZ)

  World.addResource(
    world,
    History.HistoryBuffer({
      checkpoints: [],
      undoLog: [],
      maxSize: 120,
      checkpointInterval: 5,
    }),
  )
  World.addResource(world, Command.CommandBuffer(new Map()))
  World.addResource(world, IncomingTransactions(new Map()))
  World.addResource(world, IncomingSnapshots(new Map()))

  const schedule = SystemSchedule.create()

  World.addResource(world, CanvasContext(ctx))
  World.addResource(
    world,
    ReplicationConfig({
      historyWindow: 64,
      ghostCleanupWindow: 60,
      reconcileSchedule: reconcileSchedule,
    }),
  )

  SystemSchedule.add(schedule, performRollback)
  SystemSchedule.add(schedule, cleanupGhosts)
  SystemSchedule.add(schedule, commands.spawnEphemeralCommands)
  addLogicalSystems(schedule)
  SystemSchedule.add(schedule, applyRemoteTransactions)
  SystemSchedule.add(schedule, renderSystem)
  SystemSchedule.add(schedule, commands.cleanupEphemeralCommands)
  SystemSchedule.add(schedule, commitPendingMutations)
  SystemSchedule.add(schedule, advanceWorldTick)
  SystemSchedule.add(schedule, pruneTemporalBuffers)

  const activeKeys = new Set<string>()
  const justPressed = new Set<string>()
  window.addEventListener("keydown", (e) => {
    if (!activeKeys.has(e.code)) justPressed.add(e.code)
    activeKeys.add(e.code)
  })
  window.addEventListener("keyup", (e) => activeKeys.delete(e.code))

  return {
    world,
    schedule,
    activeKeys,
    justPressed,
    timestep,
    isSynced: false,
  }
}

const server = createServer()
const reconcileSchedule = SystemSchedule.create()
SystemSchedule.add(reconcileSchedule, commands.spawnEphemeralCommands)
addLogicalSystems(reconcileSchedule)
SystemSchedule.add(reconcileSchedule, commands.cleanupEphemeralCommands)

const client = createClient(1, reconcileSchedule)

// all serdes before any network packets are deserialised.

const clientToServer = [] as {time: number; packet: Uint8Array}[]
const serverToClient = [] as {time: number; packet: Uint8Array}[]

const devtools = createDevtools(client.world)

const player = World.spawn(
  server.world,
  Position({x: 125, y: 125}),
  Color(0),
  Replicated,
)

// Reusable writers to avoid per-packet allocations
const sharedWriter = acquireWriter()

sharedWriter.reset()
writeHandshakeServer(sharedWriter, server.world.tick, {
  domainId: 0,
  tick: server.world.tick,
})
serverToClient.push({
  time: performance.now() + LATENCY_MS,
  packet: sharedWriter.toBytes(),
})

function loop() {
  const now = performance.now()

  if (!client.isSynced) {
    sharedWriter.reset()
    writeHandshakeServer(sharedWriter, server.world.tick, {
      domainId: 1,
      tick: server.world.tick,
    })
    serverToClient.push({
      time: now + LATENCY_MS,
      packet: sharedWriter.toBytes(),
    })
  }

  while (clientToServer.length > 0 && clientToServer[0].time <= now) {
    const shift = clientToServer.shift()
    if (shift === undefined) {
      continue
    }
    const {packet} = shift
    const reader = new ByteReader(packet)
    const type = readMessageType(reader)
    const tick = reader.readUint32()
    if (type === MessageType.Command) {
      const cmds = readCommands(reader, server.world.componentRegistry)
      const targetTick = Math.max(server.world.tick, tick)
      for (const command of cmds) {
        Command.record(
          server.world,
          command.target as Entity.Entity,
          command,
          targetTick,
          tick,
        )
      }
    }
  }

  while (serverToClient.length > 0 && serverToClient[0].time <= now) {
    const shift = serverToClient.shift()
    if (shift === undefined) {
      continue
    }
    const {packet} = shift
    const reader = new ByteReader(packet)
    const type = readMessageType(reader)
    const tick = reader.readUint32()
    if (type === MessageType.Handshake) {
      const handshake = readHandshakeServer(reader)
      const latencyTicks = Math.ceil(LATENCY_MS / (1000 / HZ))
      const targetTick = handshake.tick + LAG_COMPENSATION_TICKS + latencyTicks
      if (!client.isSynced) {
        World.setTick(client.world, targetTick)
        client.isSynced = true
        client.timestep.lastTime = now
        client.timestep.accumulated = 0
        const history = World.getResource(client.world, History.HistoryBuffer)
        if (history) {
          History.push(client.world, history)
        }
      } else {
        const drift = client.world.tick - targetTick
        if (Math.abs(drift) > 2) {
          World.setTick(client.world, targetTick)
        } else if (drift > 0) {
          client.timestep.accumulated -= 1
        } else if (drift < 0) {
          client.timestep.accumulated += 1
        }
      }
    } else if (type === MessageType.Transaction) {
      const transaction = readTransaction(
        reader,
        tick,
        client.world.componentRegistry,
      )
      receiveTransaction(client.world, transaction)
    } else if (type === MessageType.Snapshot) {
      const snapshot = readSnapshot(reader, tick)
      receiveSnapshot(client.world, snapshot)
    }
  }

  if (client.isSynced) {
    Timestep.advance(client.timestep, now, () => {
      let dx = 0
      let dy = 0
      if (client.activeKeys.has("KeyW")) {
        dy -= 1
      }
      if (client.activeKeys.has("KeyS")) {
        dy += 1
      }
      if (client.activeKeys.has("KeyA")) {
        dx -= 1
      }
      if (client.activeKeys.has("KeyD")) {
        dx += 1
      }
      if (dx !== 0 || dy !== 0) {
        Command.record(client.world, player, MoveCommand({dx, dy}))
      }
      if (client.justPressed.has("Space")) {
        Command.record(client.world, player, FireCommand)
        client.justPressed.delete("Space")
      }
      client.justPressed.clear()
      const commandBuffer = World.getResource(
        client.world,
        Command.CommandBuffer,
      )
      const cmds = commandBuffer?.get(client.world.tick)
      if (cmds && cmds.length > 0) {
        sharedWriter.reset()
        writeCommands(
          sharedWriter,
          client.world.tick,
          cmds,
          client.world.componentRegistry,
        )
        clientToServer.push({
          time: performance.now() + LATENCY_MS,
          packet: sharedWriter.toBytes(),
        })
      }
      SystemSchedule.run(client.schedule, client.world)
    })
  }

  Timestep.advance(server.timestep, now, () => {
    SystemSchedule.run(server.schedule, server.world)

    const stream = World.getResource(server.world, ReplicationStream)
    if (stream) {
      for (const transaction of stream.transactions) {
        sharedWriter.reset()
        writeTransaction(
          sharedWriter,
          transaction,
          server.world.componentRegistry,
        )
        serverToClient.push({
          time: performance.now() + LATENCY_MS,
          packet: sharedWriter.toBytes(),
        })
      }
      for (const packet of stream.snapshots) {
        serverToClient.push({
          time: performance.now() + LATENCY_MS,
          packet,
        })
      }
    }
  })

  const cPos = World.getComponentValue(client.world, player, Position)
  const sPos = World.getComponentValue(server.world, player, Position)
  const status = document.getElementById("status")
  if (status) {
    status.innerText =
      `Latency: ${LATENCY_MS}ms | Drift: ${client.world.tick - server.world.tick} ticks | ` +
      `Server: ${server.world.tick} (${sPos ? Math.round(sPos.x) : "?"}, ${sPos ? Math.round(sPos.y) : "?"}) | ` +
      `Client: ${client.world.tick} (${cPos ? Math.round(cPos.x) : "?"}, ${cPos ? Math.round(cPos.y) : "?"})`
  }

  devtools.update()
  requestAnimationFrame(loop)
}

loop()
