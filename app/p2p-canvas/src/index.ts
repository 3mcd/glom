import * as g from "@glom/ecs"
import * as commands from "@glom/ecs/command"
import * as reconciliation from "@glom/ecs/reconciliation"
import * as replication from "@glom/ecs/replication"

const Position = g.define_component<{x: number; y: number}>({
  bytes_per_element: 8,
  encode: (val, writer) => {
    writer.write_float32(val.x)
    writer.write_float32(val.y)
  },
  decode: (reader) => {
    return {x: reader.read_float32(), y: reader.read_float32()}
  },
})

const Color = g.define_component<number>({
  bytes_per_element: 4,
  encode: (val, writer) => {
    writer.write_uint32(val)
  },
  decode: (reader) => {
    return reader.read_uint32()
  },
})

const MoveCommand = g.define_component<{dx: number; dy: number}>({
  bytes_per_element: 8,
  encode: (val, writer) => {
    writer.write_float32(val.dx)
    writer.write_float32(val.dy)
  },
  decode: (reader) => {
    return {dx: reader.read_float32(), dy: reader.read_float32()}
  },
})

const SPEED = 2
const CanvasContext = g.define_component<CanvasRenderingContext2D>()
const schema = [Position, Color, MoveCommand, CanvasContext]

const movement_system = (
  query: g.All<
    g.Entity,
    g.Read<typeof Position>,
    g.Rel<typeof g.CommandOf, g.Read<typeof MoveCommand>>
  >,
  world: g.World,
) => {
  for (const [entity, pos, move] of query) {
    let next_x = pos.x + move.dx * SPEED
    let next_y = pos.y + move.dy * SPEED

    if (next_x < 0) next_x = 250
    if (next_x > 250) next_x = 0
    if (next_y < 0) next_y = 250
    if (next_y > 250) next_y = 0

    g.add_component(world, entity, Position({x: next_x, y: next_y}))
  }
}

const render_system = (
  query: g.All<g.Read<typeof Position>, g.Read<typeof Color>>,
  ctx: g.Write<typeof CanvasContext>,
) => {
  ctx.fillStyle = "#0f0f0f" // --bg
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)

  for (const [pos, color_id] of query) {
    ctx.fillStyle = color_id === 1 ? "#aed7f5" : "#d6d4a6"
    ctx.fillRect(pos.x - 10, pos.y - 10, 20, 20)
  }
}

function create_peer(
  domain_id: number,
  canvasId: string,
  keys: {up: string; down: string; left: string; right: string},
) {
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D
  const world = g.make_world({domain_id, schema})
  const schedule = g.make_system_schedule()

  g.add_resource(world, CanvasContext(ctx))
  g.add_resource(
    world,
    g.ReplicationConfig({
      history_window: 64,
      ghost_cleanup_window: 60,
      snapshot_components: [world.component_registry.get_id(Position)],
    }),
  )
  g.add_resource(world, g.ReplicationStream({transactions: [], snapshots: []}))
  g.add_resource(world, g.CommandBuffer(new Map()))
  g.add_resource(world, g.IncomingTransactions(new Map()))
  g.add_resource(world, g.IncomingSnapshots(new Map()))

  g.add_system(schedule, g.clear_replication_stream)
  g.add_system(schedule, reconciliation.apply_remote_transactions)
  g.add_system(schedule, reconciliation.apply_remote_snapshots)
  g.add_system(schedule, reconciliation.cleanup_ghosts)
  g.add_system(schedule, commands.spawn_ephemeral_commands)
  g.add_system(schedule, movement_system)
  g.add_system(schedule, render_system)
  g.add_system(schedule, commands.cleanup_ephemeral_commands)
  g.add_system(schedule, replication.commit_pending_mutations)
  g.add_system(schedule, replication.emit_snapshots)
  g.add_system(schedule, replication.advance_world_tick)
  g.add_system(schedule, replication.prune_temporal_buffers)

  const active_keys = new Set<string>()
  window.addEventListener("keydown", (e) => active_keys.add(e.code))
  window.addEventListener("keyup", (e) => active_keys.delete(e.code))

  return {
    world,
    schedule,
    spawn_player: () => {
      return g.spawn(world, [
        Position({x: domain_id * 60, y: 125}),
        Color(domain_id),
        g.Replicated,
      ])
    },
    update: (my_entity: g.Entity) => {
      let dx = 0,
        dy = 0
      if (active_keys.has(keys.up)) dy -= 1
      if (active_keys.has(keys.down)) dy += 1
      if (active_keys.has(keys.left)) dx -= 1
      if (active_keys.has(keys.right)) dx += 1

      if (dx !== 0 || dy !== 0) {
        g.record_command(world, my_entity, MoveCommand({dx, dy}))
      }

      g.run_schedule(schedule, world)
    },
  }
}

const peer_a = create_peer(1, "canvasA", {
  up: "KeyW",
  down: "KeyS",
  left: "KeyA",
  right: "KeyD",
})
const peer_b = create_peer(2, "canvasB", {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
})

const entity_a = peer_a.spawn_player()
const entity_b = peer_b.spawn_player()

function loop() {
  peer_a.update(entity_a)
  peer_b.update(entity_b)

  // Peer A -> Peer B
  const stream_a = g.get_resource(peer_a.world, g.ReplicationStream)
  if (stream_a) {
    for (const tx of stream_a.transactions) {
      const writer = new g.ByteWriter()
      g.write_transaction(writer, tx, peer_a.world)
      const reader = new g.ByteReader(writer.get_bytes())
      const header = g.read_message_header(reader)
      const decoded = g.read_transaction(reader, header.tick, peer_b.world)
      g.receive_transaction(peer_b.world, decoded)
    }
    for (const snap of stream_a.snapshots) {
      const writer = new g.ByteWriter()
      g.write_snapshot(writer, snap, peer_a.world)
      const reader = new g.ByteReader(writer.get_bytes())
      const header = g.read_message_header(reader)
      const decoded = g.read_snapshot(reader, header.tick, peer_b.world)
      g.receive_snapshot(peer_b.world, decoded)
    }
  }

  // Peer B -> Peer A
  const stream_b = g.get_resource(peer_b.world, g.ReplicationStream)
  if (stream_b) {
    for (const tx of stream_b.transactions) {
      const writer = new g.ByteWriter()
      g.write_transaction(writer, tx, peer_b.world)
      const reader = new g.ByteReader(writer.get_bytes())
      const header = g.read_message_header(reader)
      const decoded = g.read_transaction(reader, header.tick, peer_a.world)
      g.receive_transaction(peer_a.world, decoded)
    }
    for (const snap of stream_b.snapshots) {
      const writer = new g.ByteWriter()
      g.write_snapshot(writer, snap, peer_b.world)
      const reader = new g.ByteReader(writer.get_bytes())
      const header = g.read_message_header(reader)
      const decoded = g.read_snapshot(reader, header.tick, peer_a.world)
      g.receive_snapshot(peer_a.world, decoded)
    }
  }

  requestAnimationFrame(loop)
}

loop()
