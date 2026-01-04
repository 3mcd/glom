import * as g from "@glom/ecs"
import * as commands from "@glom/ecs/command"
import * as reconciliation from "@glom/ecs/reconciliation"
import * as replication from "@glom/ecs/replication"

// 1. Components & Definitions with Serdes for binary transport
const Position = g.define_component<{ x: number; y: number }>({
  bytes_per_element: 8,
  encode: (val, writer) => {
    writer.write_float32(val.x)
    writer.write_float32(val.y)
  },
  decode: (reader) => {
    return { x: reader.read_float32(), y: reader.read_float32() }
  },
})

// Color as an integer ID (1=Red, 2=Blue) to keep it simple for serialization
const Color = g.define_component<number>({
  bytes_per_element: 4,
  encode: (val, writer) => {
    writer.write_uint32(val)
  },
  decode: (reader) => {
    return reader.read_uint32()
  },
})

const MoveCommand = g.define_component<{ dx: number; dy: number }>({
  bytes_per_element: 8,
  encode: (val, writer) => {
    writer.write_float32(val.dx)
    writer.write_float32(val.dy)
  },
  decode: (reader) => {
    return { dx: reader.read_float32(), dy: reader.read_float32() }
  },
})

const SPEED = 2
const schema = [Position, Color, MoveCommand]

// 2. Systems
const movement_system = g.define_system(
  (
    // We need the Entity and World to call add_component for replication
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

      // Wrap around canvas
      if (next_x < 0) next_x = 400
      if (next_x > 400) next_x = 0
      if (next_y < 0) next_y = 400
      if (next_y > 400) next_y = 0

      // Use add_component to trigger the ReplicationRecorder
      g.add_component(world, entity, Position({ x: next_x, y: next_y }))
    }
  },
  {
    params: [
      g.All(
        g.Entity,
        g.Read(Position),
        g.Rel(g.CommandOf, g.Read(MoveCommand)),
      ),
      g.WorldTerm(),
    ],
  },
)

function make_render_system(ctx: CanvasRenderingContext2D) {
  return g.define_system(
    (query: g.All<g.Read<typeof Position>, g.Read<typeof Color>>) => {
      ctx.fillStyle = "black"
      ctx.fillRect(0, 0, 400, 400)

      for (const [pos, color_id] of query) {
        ctx.fillStyle = color_id === 1 ? "#ff4444" : "#4444ff"
        ctx.fillRect(pos.x - 10, pos.y - 10, 20, 20)
      }
    },
    { params: [g.All(g.Read(Position), g.Read(Color))] },
  )
}

// 3. Peer Setup
function create_peer(
  hi: number,
  canvasId: string,
  keys: { up: string; down: string; left: string; right: string },
) {
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D
  const world = g.make_world(hi, schema)
  const schedule = g.make_system_schedule()

  // Add networking systems
  g.add_resource(
    world,
    g.ReplicationConfig({
      history_window: 64,
      ghost_cleanup_window: 60,
      snapshot_components: [world.component_registry.get_id(Position)],
    }),
  )

  g.add_system(schedule, reconciliation.apply_remote_transactions)
  g.add_system(schedule, reconciliation.apply_remote_snapshots)
  g.add_system(schedule, reconciliation.cleanup_ghosts)
  g.add_system(schedule, commands.spawn_ephemeral_commands)
  g.add_system(schedule, movement_system)
  g.add_system(schedule, make_render_system(ctx))
  g.add_system(schedule, commands.cleanup_ephemeral_commands)
  g.add_system(schedule, replication.commit_pending_mutations)

  // Emit snapshots every 10 ticks
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
        Position({ x: hi * 100, y: 200 }),
        Color(hi), // Color ID matches Peer ID
        g.Replicated,
      ])
    },
    update: (my_entity: g.Entity) => {
      let dx = 0
      let dy = 0
      if (active_keys.has(keys.up)) dy -= 1
      if (active_keys.has(keys.down)) dy += 1
      if (active_keys.has(keys.left)) dx -= 1
      if (active_keys.has(keys.right)) dx += 1

      if (dx !== 0 || dy !== 0) {
        g.record_command(world, my_entity, MoveCommand({ dx, dy }))
      }

      g.run_schedule(schedule, world)
    },
  }
}

// Initialize peers
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

// 4. "Network" Pipe with Binary Round-Trip
// Connect the peers before spawning to capture the initial 'spawn' events
const link = (from: g.World, to: g.World) => {
  from.recorder = (tx) => {
    // Round-trip through binary protocol to ensure it's solid
    const writer = new g.ByteWriter()
    g.write_transaction(writer, tx, from)

    const reader = new g.ByteReader(writer.get_bytes())
    const header = g.read_message_header(reader)
    const decoded = g.read_transaction(reader, header.tick, to)

    g.apply_transaction(to, decoded)
  }

  from.snapshot_emitter = (snap) => {
    // Round-trip through binary protocol
    const writer = new g.ByteWriter()
    g.write_snapshot(writer, snap, from)

    const reader = new g.ByteReader(writer.get_bytes())
    const header = g.read_message_header(reader)
    const decoded = g.read_snapshot(reader, header.tick, to)

    // Buffer the snapshot in the target world
    let list = to.remote_snapshots.get(decoded.tick)
    if (!list) {
      list = []
      to.remote_snapshots.set(decoded.tick, list)
    }
    list.push(decoded)
  }
}

link(peer_a.world, peer_b.world)
link(peer_b.world, peer_a.world)

// Now spawn the players
const entity_a = peer_a.spawn_player()
const entity_b = peer_b.spawn_player()

// 5. Main Loop
function loop() {
  peer_a.update(entity_a)
  peer_b.update(entity_b)
  requestAnimationFrame(loop)
}

loop()
