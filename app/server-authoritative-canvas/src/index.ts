import {createDevtools} from "@glom/devtools"
import * as g from "@glom/ecs"
import * as commands from "@glom/ecs/command"
import * as reconciliation from "@glom/ecs/reconciliation"
import * as replication from "@glom/ecs/replication"

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

const Color = g.defineComponent<number>("Color", {
  bytesPerElement: 4,
  encode: (val, writer) => {
    writer.writeUint32(val)
  },
  decode: (reader) => {
    return reader.readUint32()
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

const Pulse = g.defineComponent<number>("Pulse", {
  bytesPerElement: 8,
  encode: (val, writer) => {
    writer.writeFloat64(val)
  },
  decode: (reader) => {
    return reader.readFloat64()
  },
})

const FireCommand = g.defineTag("FireCommand")
const PulseOf = g.defineRelation("PulseOf")
const CanvasContext =
  g.defineComponent<CanvasRenderingContext2D>("CanvasContext")

const SPEED = 2
const LATENCY_MS = 100
const HZ = 60
const LAG_COMPENSATION_TICKS = 15

const schema = [
  Position,
  Color,
  MoveCommand,
  Pulse,
  FireCommand,
  PulseOf,
  CanvasContext,
]

function addLogicalSystems(schedule: g.SystemSchedule) {
  g.addSystem(schedule, movementSystem)
  g.addSystem(schedule, pulseSpawnerSystem)
  g.addSystem(schedule, pulseSystem)
  g.addSystem(schedule, attachedPulseSystem)
}

function movementSystem(
  query: g.Join<
    g.All<g.Write<typeof Position>>,
    g.All<typeof MoveCommand>,
    typeof g.CommandOf
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
  query: g.Join<
    g.All<g.Entity, typeof Position>,
    g.All<typeof g.IntentTick, g.Has<typeof FireCommand>>,
    typeof g.CommandOf
  >,
  world: g.World,
) {
  for (const [playerEnt, pos, intentTick] of query) {
    g.spawnInDomain(
      world,
      [Position({...pos}), Pulse(5), PulseOf(playerEnt), g.Replicated],
      world.registry.domainId,
      intentTick,
    )
  }
}

function pulseSystem(
  query: g.All<g.Entity, typeof Pulse>,
  update: g.Add<typeof Pulse>,
  despawn: g.Despawn,
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
  pulses: g.Join<
    g.All<g.Write<typeof Position>>,
    g.All<typeof Position>,
    typeof PulseOf
  >,
) {
  for (const [pos, parentPos] of pulses) {
    pos.x = parentPos.x
    pos.y = parentPos.y
  }
}

function renderSystem(
  query: g.All<typeof Position, typeof Color>,
  pulses: g.All<typeof Position, typeof Pulse>,
  ctx: g.Write<typeof CanvasContext>,
) {
  ctx.fillStyle = "#0f0f0f" // --bg
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)

  let count = 0
  for (const [pos, colorId] of query) {
    count++
    ctx.fillStyle = (colorId as number) === 0 ? "#aed7f5" : "#d6d4a6"
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
  const world = g.makeWorld({domainId: 0}) as g.World
  const schedule = g.makeSystemSchedule()
  const timestep = g.makeTimestep(HZ)

  g.addResource(world, CanvasContext(ctx))
  g.addResource(
    world,
    g.ReplicationConfig({
      historyWindow: 64,
      snapshotComponents: [world.componentRegistry.getId(Position)],
      snapshotInterval: 5,
    }),
  )
  g.addResource(world, g.ReplicationStream({transactions: [], snapshots: []}))
  g.addResource(world, g.CommandBuffer(new Map()))
  g.addResource(world, g.IncomingTransactions(new Map()))
  g.addResource(world, g.IncomingSnapshots(new Map()))

  g.addSystem(schedule, g.clearReplicationStream)
  g.addSystem(schedule, reconciliation.applyRemoteTransactions)
  g.addSystem(schedule, commands.spawnEphemeralCommands)
  addLogicalSystems(schedule)
  g.addSystem(schedule, renderSystem)
  g.addSystem(schedule, commands.cleanupEphemeralCommands)
  g.addSystem(schedule, replication.commitPendingMutations)
  g.addSystem(schedule, replication.emitSnapshots)
  g.addSystem(schedule, replication.advanceWorldTick)
  g.addSystem(schedule, replication.pruneTemporalBuffers)

  return {world, schedule, timestep}
}

function createClient(domainId: number, reconcileSchedule: g.SystemSchedule) {
  const canvas = document.getElementById("canvasClient") as HTMLCanvasElement
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D
  const world = g.makeWorld({domainId}) as g.World
  const timestep = g.makeTimestep(HZ)

  g.addResource(
    world,
    g.HistoryBuffer({
      checkpoints: [],
      undoLog: [],
      maxSize: 120,
      checkpointInterval: 5,
    }),
  )
  g.addResource(world, g.CommandBuffer(new Map()))
  g.addResource(world, g.InputBuffer(new Map()))
  g.addResource(world, g.IncomingTransactions(new Map()))
  g.addResource(world, g.IncomingSnapshots(new Map()))

  const schedule = g.makeSystemSchedule()

  g.addResource(world, CanvasContext(ctx))
  g.addResource(
    world,
    g.ReplicationConfig({
      historyWindow: 64,
      ghostCleanupWindow: 60,
      reconcileSchedule: reconcileSchedule,
    }),
  )

  g.addSystem(schedule, reconciliation.performRollback)
  g.addSystem(schedule, reconciliation.cleanupGhosts)
  g.addSystem(schedule, commands.spawnEphemeralCommands)
  addLogicalSystems(schedule)
  g.addSystem(schedule, reconciliation.applyRemoteTransactions)
  g.addSystem(schedule, renderSystem)
  g.addSystem(schedule, commands.cleanupEphemeralCommands)
  g.addSystem(schedule, replication.commitPendingMutations)
  g.addSystem(schedule, replication.advanceWorldTick)
  g.addSystem(schedule, replication.pruneTemporalBuffers)

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
const reconcileSchedule = g.makeSystemSchedule()
g.addSystem(reconcileSchedule, commands.spawnEphemeralCommands)
addLogicalSystems(reconcileSchedule)
g.addSystem(reconcileSchedule, commands.cleanupEphemeralCommands)

const client = createClient(1, reconcileSchedule)

// all serdes before any network packets are deserialised.

const clientToServer = [] as {time: number; packet: Uint8Array}[]
const serverToClient = [] as {time: number; packet: Uint8Array}[]

const devtools = createDevtools(client.world)

const player = g.spawn(
  server.world,
  Position({x: 125, y: 125}),
  Color(0),
  g.Replicated,
)

// Reusable writers to avoid per-packet allocations
const sharedWriter = g.acquireWriter()

sharedWriter.reset()
g.writeHandshakeServer(sharedWriter, server.world.tick, {
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
    g.writeHandshakeServer(sharedWriter, server.world.tick, {
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
    if (!shift) continue
    const {packet} = shift
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
            } as g.ComponentLike,
            value: cmd.data,
          },
          targetTick,
          cmdMsg.tick,
        )
      }
    }
  }

  while (serverToClient.length > 0 && serverToClient[0].time <= now) {
    const shift = serverToClient.shift()
    if (!shift) continue
    const {packet} = shift
    const reader = new g.ByteReader(packet)
    const header = g.readMessageHeader(reader)

    if (header.type === g.MessageType.Handshake) {
      const handshake = g.readHandshakeServer(reader)
      const latencyTicks = Math.ceil(LATENCY_MS / (1000 / HZ))
      const targetTick = handshake.tick + LAG_COMPENSATION_TICKS + latencyTicks

      if (!client.isSynced) {
        g.setTick(client.world, targetTick)
        client.isSynced = true
        client.timestep.lastTime = now
        client.timestep.accumulated = 0
        const history = g.getResource(client.world, g.HistoryBuffer)
        if (history) g.pushCheckpoint(client.world, history)
      } else {
        const drift = client.world.tick - targetTick
        if (Math.abs(drift) > 2) g.setTick(client.world, targetTick)
        else if (drift > 0) client.timestep.accumulated -= 1
        else if (drift < 0) client.timestep.accumulated += 1
      }
    } else if (header.type === g.MessageType.Transaction) {
      const transaction = g.readTransaction(reader, header.tick, client.world)
      g.receiveTransaction(client.world, transaction)
    } else if (header.type === g.MessageType.Snapshot) {
      const snapshot = g.readSnapshot(reader, header.tick)
      g.receiveSnapshot(client.world, snapshot)
    }
  }

  if (client.isSynced) {
    g.advanceTimestep(client.timestep, now, () => {
      let dx = 0,
        dy = 0
      if (client.activeKeys.has("KeyW")) dy -= 1
      if (client.activeKeys.has("KeyS")) dy += 1
      if (client.activeKeys.has("KeyA")) dx -= 1
      if (client.activeKeys.has("KeyD")) dx += 1

      if (dx !== 0 || dy !== 0)
        g.recordCommand(client.world, player, MoveCommand({dx, dy}))
      if (client.justPressed.has("Space")) {
        g.recordCommand(client.world, player, FireCommand)
        client.justPressed.delete("Space")
      }
      client.justPressed.clear()

      const commandBuffer = g.getResource(client.world, g.CommandBuffer)
      const commands = commandBuffer?.get(client.world.tick)
      if (commands && commands.length > 0) {
        sharedWriter.reset()
        g.writeCommands(
          sharedWriter,
          {tick: client.world.tick, commands},
          client.world,
        )
        clientToServer.push({
          time: performance.now() + LATENCY_MS,
          packet: sharedWriter.toBytes(),
        })
      }
      g.runSchedule(client.schedule, client.world)
    })
  }

  g.advanceTimestep(server.timestep, now, () => {
    g.runSchedule(server.schedule, server.world)

    const stream = g.getResource(server.world, g.ReplicationStream)
    if (stream) {
      for (const transaction of stream.transactions) {
        sharedWriter.reset()
        g.writeTransaction(sharedWriter, transaction, server.world)
        serverToClient.push({
          time: performance.now() + LATENCY_MS,
          packet: sharedWriter.toBytes(),
        })
      }
      // snapshots are pre-serialized by emitSnapshots — send directly
      for (const raw of stream.snapshots) {
        serverToClient.push({
          time: performance.now() + LATENCY_MS,
          packet: raw,
        })
      }
    }
  })

  const cPos = g.getComponentValue(client.world, player, Position)
  const sPos = g.getComponentValue(server.world, player, Position)
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
