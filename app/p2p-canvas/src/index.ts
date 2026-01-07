import * as g from "@glom/ecs"
import * as commands from "@glom/ecs/command"
import * as reconciliation from "@glom/ecs/reconciliation"
import * as replication from "@glom/ecs/replication"

const Position = g.defineComponent<{x: number; y: number}>({
  bytesPerElement: 8,
  encode: (val, writer) => {
    writer.writeFloat32(val.x)
    writer.writeFloat32(val.y)
  },
  decode: (reader) => {
    return {x: reader.readFloat32(), y: reader.readFloat32()}
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
const CanvasContext = g.defineComponent<CanvasRenderingContext2D>()
const schema = [Position, Color, MoveCommand, CanvasContext]

const movementSystem = (
  query: g.Join<
    g.All<g.Entity, typeof Position>,
    g.All<typeof MoveCommand>,
    typeof g.CommandOf
  >,
  world: g.World,
) => {
  for (const [entity, pos, move] of query) {
    let nextX = pos.x + move.dx * SPEED
    let nextY = pos.y + move.dy * SPEED

    if (nextX < 0) nextX = 250
    if (nextX > 250) nextX = 0
    if (nextY < 0) nextY = 250
    if (nextY > 250) nextY = 0

    g.addComponent(world, entity, Position({x: nextX, y: nextY}))
  }
}

const renderSystem = (
  query: g.All<typeof Position, typeof Color>,
  ctx: g.Write<typeof CanvasContext>,
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
  const world = g.makeWorld({domainId, schema})
  const schedule = g.makeSystemSchedule()

  g.addResource(world, CanvasContext(ctx))
  g.addResource(
    world,
    g.ReplicationConfig({
      historyWindow: 64,
      ghostCleanupWindow: 60,
      snapshotComponents: [
        world.componentRegistry.getId(Position),
        world.componentRegistry.getId(Color),
      ],
    }),
  )
  g.addResource(world, g.ReplicationStream({transactions: [], snapshots: []}))
  g.addResource(world, g.CommandBuffer(new Map()))
  g.addResource(world, g.IncomingTransactions(new Map()))
  g.addResource(world, g.IncomingSnapshots(new Map()))

  g.addSystem(schedule, g.clearReplicationStream)
  g.addSystem(schedule, reconciliation.applyRemoteTransactions)
  g.addSystem(schedule, reconciliation.applyRemoteSnapshots)
  g.addSystem(schedule, reconciliation.cleanupGhosts)
  g.addSystem(schedule, commands.spawnEphemeralCommands)
  g.addSystem(schedule, movementSystem)
  g.addSystem(schedule, renderSystem)
  g.addSystem(schedule, commands.cleanupEphemeralCommands)
  g.addSystem(schedule, replication.commitPendingMutations)
  g.addSystem(schedule, replication.emitSnapshots)
  g.addSystem(schedule, replication.advanceWorldTick)
  g.addSystem(schedule, replication.pruneTemporalBuffers)

  const activeKeys = new Set<string>()
  window.addEventListener("keydown", (e) => activeKeys.add(e.code))
  window.addEventListener("keyup", (e) => activeKeys.delete(e.code))

  return {
    world,
    schedule,
    spawnPlayer: () => {
      return g.spawn(
        world,
        Position({x: domainId * 60, y: 125}),
        Color(domainId),
        g.Replicated,
      )
    },
    update: (myEntity: g.Entity) => {
      let dx = 0,
        dy = 0
      if (activeKeys.has(keys.up)) dy -= 1
      if (activeKeys.has(keys.down)) dy += 1
      if (activeKeys.has(keys.left)) dx -= 1
      if (activeKeys.has(keys.right)) dx += 1

      if (dx !== 0 || dy !== 0) {
        g.recordCommand(world, myEntity, MoveCommand({dx, dy}))
      }

      g.runSchedule(schedule, world)
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

const entityA = peerA.spawnPlayer()
const entityB = peerB.spawnPlayer()

function loop() {
  peerA.update(entityA)
  peerB.update(entityB)

  // Peer A -> Peer B
  const streamA = g.getResource(peerA.world, g.ReplicationStream)
  if (streamA) {
    for (const tx of streamA.transactions) {
      const writer = new g.ByteWriter()
      g.writeTransaction(writer, tx, peerA.world)
      const reader = new g.ByteReader(writer.getBytes())
      const header = g.readMessageHeader(reader)
      const decoded = g.readTransaction(reader, header.tick, peerB.world)
      g.receiveTransaction(peerB.world, decoded)
    }
    for (const snap of streamA.snapshots) {
      const writer = new g.ByteWriter()
      g.writeSnapshot(writer, snap, peerA.world)
      const reader = new g.ByteReader(writer.getBytes())
      const header = g.readMessageHeader(reader)
      const decoded = g.readSnapshot(reader, header.tick, peerB.world)
      g.receiveSnapshot(peerB.world, decoded)
    }
  }

  // Peer B -> Peer A
  const streamB = g.getResource(peerB.world, g.ReplicationStream)
  if (streamB) {
    for (const tx of streamB.transactions) {
      const writer = new g.ByteWriter()
      g.writeTransaction(writer, tx, peerB.world)
      const reader = new g.ByteReader(writer.getBytes())
      const header = g.readMessageHeader(reader)
      const decoded = g.readTransaction(reader, header.tick, peerA.world)
      g.receiveTransaction(peerA.world, decoded)
    }
    for (const snap of streamB.snapshots) {
      const writer = new g.ByteWriter()
      g.writeSnapshot(writer, snap, peerB.world)
      const reader = new g.ByteReader(writer.getBytes())
      const header = g.readMessageHeader(reader)
      const decoded = g.readSnapshot(reader, header.tick, peerA.world)
      g.receiveSnapshot(peerA.world, decoded)
    }
  }

  requestAnimationFrame(loop)
}

loop()
