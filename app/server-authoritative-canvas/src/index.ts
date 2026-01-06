import * as g from "@glom/ecs"
import * as commands from "@glom/ecs/command"
import * as reconciliation from "@glom/ecs/reconciliation"
import * as replication from "@glom/ecs/replication"

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

const Color = g.defineComponent<number>({
  bytesPerElement: 4,
  encode: (val, writer) => {
    writer.writeUint32(val)
  },
  decode: (reader) => {
    return reader.readUint32()
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

const Pulse = g.defineComponent<number>({
  bytesPerElement: 8,
  encode: (val, writer) => {
    writer.writeFloat64(val)
  },
  decode: (reader) => {
    return reader.readFloat64()
  },
})

const FireCommand = g.defineTag()
const PulseOf = g.defineRelation()
const CanvasContext = g.defineComponent<CanvasRenderingContext2D>()

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

const pulseSpawnerSystem = (
  query: g.All<
    g.Entity,
    g.Read<typeof Position>,
    g.Rel<typeof g.CommandOf, g.Has<typeof FireCommand>>
  >,
  world: g.World,
) => {
  for (const [playerEnt, pos] of query) {
    const incoming = world.relations.objectToSubjects.get(playerEnt)
    let intentTick = world.tick
    if (incoming) {
      for (const {subject, relationId} of incoming) {
        if (relationId === world.componentRegistry.getId(g.CommandOf)) {
          const it = g.getComponentValue(
            world,
            subject as g.Entity,
            g.IntentTick,
          )
          if (it !== undefined) {
            intentTick = it
            break
          }
        }
      }
    }

    g.spawn(
      world,
      [Position(pos), Pulse(5), PulseOf(playerEnt), g.Replicated],
      world.registry.domainId,
      intentTick,
    )
  }
}

const movementSystem = (
  query: g.All<
    g.Entity,
    g.Read<typeof Position>,
    g.Rel<typeof g.CommandOf, g.Read<typeof MoveCommand>>
  >,
  update: g.Add<typeof Position>,
) => {
  for (const [entity, pos, move] of query) {
    let nextX = pos.x + move.dx * SPEED
    let nextY = pos.y + move.dy * SPEED

    if (nextX < 0) nextX = 250
    if (nextX > 250) nextX = 0
    if (nextY < 0) nextY = 250
    if (nextY > 250) nextY = 0

    update(entity, {x: nextX, y: nextY})
  }
}

const pulseSystem = (
  query: g.All<g.Entity, g.Read<typeof Pulse>>,
  update: g.Add<typeof Pulse>,
  despawn: g.Despawn,
) => {
  for (const [entity, size] of query) {
    const nextSize = (size as number) + 1.5
    if (nextSize > 40) {
      despawn(entity)
    } else {
      update(entity, nextSize)
    }
  }
}

const attachedPulseSystem = (
  pulses: g.All<
    g.Entity,
    g.Read<typeof Position>,
    g.Rel<typeof PulseOf, g.Read<typeof Position>>
  >,
  update: g.Add<typeof Position>,
) => {
  for (const [pulseEnt, _pos, parentPos] of pulses) {
    update(pulseEnt, {x: parentPos.x, y: parentPos.y})
  }
}

const renderSystem = (
  query: g.All<g.Read<typeof Position>, g.Read<typeof Color>>,
  pulses: g.All<g.Read<typeof Position>, g.Read<typeof Pulse>>,
  ctx: g.Write<typeof CanvasContext>,
) => {
  ctx.fillStyle = "#0f0f0f" // --bg
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)

  for (const [pos, colorId] of query) {
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
  const world = g.makeWorld({domainId: 0, schema}) as g.World
  const schedule = g.makeSystemSchedule()
  const timestep = g.makeTimestep(HZ)

  g.addResource(world, CanvasContext(ctx))
  g.addResource(world, g.ReplicationConfig({historyWindow: 64}))
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
  g.addSystem(schedule, replication.advanceWorldTick)
  g.addSystem(schedule, replication.pruneTemporalBuffers)

  return {world, schedule, timestep}
}

function createClient(domainId: number, reconcileSchedule: g.SystemSchedule) {
  const canvas = document.getElementById("canvasClient") as HTMLCanvasElement
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D
  const world = g.makeWorld({domainId, schema}) as g.World
  const timestep = g.makeTimestep(HZ)

  g.addResource(world, g.HistoryBuffer({snapshots: [], maxSize: 120}))
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
const clientToServer = [] as {time: number; packet: Uint8Array}[]
const serverToClient = [] as {time: number; packet: Uint8Array}[]

const player = g.spawn(server.world, [
  Position({x: 125, y: 125}),
  Color(0),
  g.Replicated,
])

const writer = new g.ByteWriter()
g.writeHandshakeServer(writer, server.world.tick, {
  domainId: 0,
  tick: server.world.tick,
})
serverToClient.push({
  time: performance.now() + LATENCY_MS,
  packet: writer.getBytes(),
})

function loop() {
  const now = performance.now()

  if (!client.isSynced) {
    const writer = new g.ByteWriter()
    g.writeHandshakeServer(writer, server.world.tick, {
      domainId: 1,
      tick: server.world.tick,
    })
    serverToClient.push({time: now + LATENCY_MS, packet: writer.getBytes()})
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
        if (history) g.pushSnapshot(client.world, history)
      } else {
        const drift = client.world.tick - targetTick
        if (Math.abs(drift) > 2) g.setTick(client.world, targetTick)
        else if (drift > 0) client.timestep.accumulated -= 1
        else if (drift < 0) client.timestep.accumulated += 1
      }
    } else if (header.type === g.MessageType.Transaction) {
      const transaction = g.readTransaction(reader, header.tick, client.world)
      g.receiveTransaction(client.world, transaction)
    }
  }

  if (client.isSynced) {
    g.timestepUpdate(client.timestep, now, () => {
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
        const writer = new g.ByteWriter()
        g.writeCommands(
          writer,
          {tick: client.world.tick, commands},
          client.world,
        )
        clientToServer.push({
          time: performance.now() + LATENCY_MS,
          packet: writer.getBytes(),
        })
      }
      g.runSchedule(client.schedule, client.world)
    })
  }

  g.timestepUpdate(server.timestep, now, () => {
    g.runSchedule(server.schedule, server.world)

    const stream = g.getResource(server.world, g.ReplicationStream)
    if (stream) {
      for (const transaction of stream.transactions) {
        const writer = new g.ByteWriter()
        g.writeTransaction(writer, transaction, server.world)
        serverToClient.push({
          time: performance.now() + LATENCY_MS,
          packet: writer.getBytes(),
        })
      }
      for (const snap of stream.snapshots) {
        const writer = new g.ByteWriter()
        g.writeSnapshot(writer, snap, server.world)
        serverToClient.push({
          time: performance.now() + LATENCY_MS,
          packet: writer.getBytes(),
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

  requestAnimationFrame(loop)
}

loop()
