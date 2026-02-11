import {
  Component,
  Command,
  Entity,
  Relation,
  SystemSchedule,
  World,
  // Query types
  type All,
  type Join,
  type Write,
  // Protocol / binary
  acquireWriter,
  ByteReader,
  readMessageType,
  readSnapshot,
  readTransaction,
  writeTransaction,
  // Replication
  Replicated,
  ReplicationConfig,
  ReplicationStream,
  IncomingSnapshots,
  IncomingTransactions,
  clearReplicationStream,
  commitPendingMutations,
  emitSnapshots,
  advanceWorldTick,
  pruneTemporalBuffers,
  receiveSnapshot,
  receiveTransaction,
  // Reconciliation
  applyRemoteTransactions,
  applyRemoteSnapshots,
  cleanupGhosts,
} from "@glom/ecs"
import * as commands from "@glom/ecs/command"

const Position = Component.define<{x: number; y: number}>("Position", {
  bytesPerElement: 8,
  encode: (val, writer) => {
    writer.writeFloat32(val.x)
    writer.writeFloat32(val.y)
  },
  decode: (reader) => {
    return {x: reader.readFloat32(), y: reader.readFloat32()}
  },
})

const Color = Component.define<number>("Color", {
  bytesPerElement: 4,
  encode: (val, writer) => {
    writer.writeUint32(val)
  },
  decode: (reader) => {
    return reader.readUint32()
  },
})

const MoveCommand = Component.define<{dx: number; dy: number}>("MoveCommand", {
  bytesPerElement: 8,
  encode: (val, writer) => {
    writer.writeFloat32(val.dx)
    writer.writeFloat32(val.dy)
  },
  decode: (reader) => {
    return {dx: reader.readFloat32(), dy: reader.readFloat32()}
  },
})

const SPEED = 2
const CanvasContext =
  Component.define<CanvasRenderingContext2D>("CanvasContext")
const schema = [Position, Color, MoveCommand, CanvasContext]

const movementSystem = (
  query: Join<
    All<Entity.Entity, typeof Position>,
    All<typeof MoveCommand>,
    typeof Command.CommandOf
  >,
  world: World.World,
) => {
  for (const [entity, pos, move] of query) {
    let nextX = pos.x + move.dx * SPEED
    let nextY = pos.y + move.dy * SPEED

    if (nextX < 0) nextX = 250
    if (nextX > 250) nextX = 0
    if (nextY < 0) nextY = 250
    if (nextY > 250) nextY = 0

    World.addComponent(world, entity, Position({x: nextX, y: nextY}))
  }
}

const renderSystem = (
  query: All<typeof Position, typeof Color>,
  ctx: Write<typeof CanvasContext>,
) => {
  ctx.fillStyle = "#0f0f0f" // --bg
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)

  for (const [pos, colorId] of query) {
    ctx.fillStyle = colorId === 1 ? "#aed7f5" : "#d6d4a6"
    ctx.fillRect(pos.x - 10, pos.y - 10, 20, 20)
  }
}

function createPeer(
  domainId: number,
  canvasId: string,
  keys: {up: string; down: string; left: string; right: string},
) {
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D
  const world = World.create({domainId})
  const schedule = SystemSchedule.create()

  World.addResource(world, CanvasContext(ctx))
  World.addResource(
    world,
    ReplicationConfig({
      historyWindow: 64,
      ghostCleanupWindow: 60,
      snapshotComponents: [
        world.componentRegistry.getId(Position),
        world.componentRegistry.getId(Color),
      ],
    }),
  )
  World.addResource(world, ReplicationStream({transactions: [], snapshots: []}))
  World.addResource(world, Command.CommandBuffer(new Map()))
  World.addResource(world, IncomingTransactions(new Map()))
  World.addResource(world, IncomingSnapshots(new Map()))

  SystemSchedule.add(schedule, clearReplicationStream)
  SystemSchedule.add(schedule, applyRemoteTransactions)
  SystemSchedule.add(schedule, applyRemoteSnapshots)
  SystemSchedule.add(schedule, cleanupGhosts)
  SystemSchedule.add(schedule, commands.spawnEphemeralCommands)
  SystemSchedule.add(schedule, movementSystem)
  SystemSchedule.add(schedule, renderSystem)
  SystemSchedule.add(schedule, commands.cleanupEphemeralCommands)
  SystemSchedule.add(schedule, commitPendingMutations)
  SystemSchedule.add(schedule, emitSnapshots)
  SystemSchedule.add(schedule, advanceWorldTick)
  SystemSchedule.add(schedule, pruneTemporalBuffers)

  const activeKeys = new Set<string>()
  window.addEventListener("keydown", (e) => activeKeys.add(e.code))
  window.addEventListener("keyup", (e) => activeKeys.delete(e.code))

  return {
    world,
    schedule,
    spawnPlayer: () => {
      return World.spawn(
        world,
        Position({x: domainId * 60, y: 125}),
        Color(domainId),
        Replicated,
      )
    },
    update: (myEntity: Entity.Entity) => {
      let dx = 0,
        dy = 0
      if (activeKeys.has(keys.up)) dy -= 1
      if (activeKeys.has(keys.down)) dy += 1
      if (activeKeys.has(keys.left)) dx -= 1
      if (activeKeys.has(keys.right)) dx += 1

      if (dx !== 0 || dy !== 0) {
        Command.record(world, myEntity, MoveCommand({dx, dy}))
      }

      SystemSchedule.run(schedule, world)
    },
  }
}

const peerA = createPeer(1, "canvasA", {
  up: "KeyW",
  down: "KeyS",
  left: "KeyA",
  right: "KeyD",
})
const peerB = createPeer(2, "canvasB", {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
})

// before deserialising the other peer's transactions.

const entityA = peerA.spawnPlayer()
const entityB = peerB.spawnPlayer()

const sharedWriter = acquireWriter()

function loop() {
  peerA.update(entityA)
  peerB.update(entityB)

  // Peer A -> Peer B
  const streamA = World.getResource(peerA.world, ReplicationStream)
  if (streamA) {
    for (const tx of streamA.transactions) {
      sharedWriter.reset()
      writeTransaction(sharedWriter, tx, peerA.world.componentRegistry)
      const reader = new ByteReader(sharedWriter.toBytes())
      readMessageType(reader) // MessageType.Transaction
      const tick = reader.readUint32()
      const decoded = readTransaction(
        reader,
        tick,
        peerB.world.componentRegistry,
      )
      receiveTransaction(peerB.world, decoded)
    }
    for (const raw of streamA.snapshots) {
      const reader = new ByteReader(raw)
      readMessageType(reader) // MessageType.Snapshot
      const tick = reader.readUint32()
      const decoded = readSnapshot(reader, tick)
      receiveSnapshot(peerB.world, decoded)
    }
  }

  // Peer B -> Peer A
  const streamB = World.getResource(peerB.world, ReplicationStream)
  if (streamB) {
    for (const tx of streamB.transactions) {
      sharedWriter.reset()
      writeTransaction(sharedWriter, tx, peerB.world.componentRegistry)
      const reader = new ByteReader(sharedWriter.toBytes())
      readMessageType(reader) // MessageType.Transaction
      const tick = reader.readUint32()
      const decoded = readTransaction(
        reader,
        tick,
        peerA.world.componentRegistry,
      )
      receiveTransaction(peerA.world, decoded)
    }
    for (const raw of streamB.snapshots) {
      const reader = new ByteReader(raw)
      readMessageType(reader) // MessageType.Snapshot
      const tick = reader.readUint32()
      const decoded = readSnapshot(reader, tick)
      receiveSnapshot(peerA.world, decoded)
    }
  }

  requestAnimationFrame(loop)
}

loop()
