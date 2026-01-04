import type {
  Add,
  All,
  Component,
  Entity,
  Has,
  Read,
  Rel,
  SystemSchedule,
  World,
  Write,
} from "@glom/ecs"
import * as g from "@glom/ecs"
import * as commands from "@glom/ecs/command"
import * as reconciliation from "@glom/ecs/reconciliation"
import * as replication from "@glom/ecs/replication"

// 1. Components & Definitions with Serdes
const Position = g.define_component<{ x: number; y: number }>({
  bytes_per_element: 16,
  encode: (val, writer) => {
    writer.write_float64(val.x)
    writer.write_float64(val.y)
  },
  decode: (reader) => {
    return { x: reader.read_float64(), y: reader.read_float64() }
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

const MoveCommand = g.define_component<{ dx: number; dy: number }>({
  bytes_per_element: 16,
  encode: (val, writer) => {
    writer.write_float64(val.dx)
    writer.write_float64(val.dy)
  },
  decode: (reader) => {
    return { dx: reader.read_float64(), dy: reader.read_float64() }
  },
})

const Pulse = g.define_component<number>({
  bytes_per_element: 8,
  encode: (val, writer) => {
    writer.write_float64(val)
  },
  decode: (reader) => {
    return reader.read_float64()
  },
})

const FireCommand = g.define_tag()
const PulseOf = g.define_relation()
const CanvasContext = g.define_component<CanvasRenderingContext2D>()

const SPEED = 2
const LATENCY_MS = 100 // One-way artificial latency
const HZ = 60
const LAG_COMPENSATION_TICKS = 15 // Increased buffer to ensure commands are always "future"

// 2. Shared Systems
const schema = [
  Position,
  Color,
  MoveCommand,
  Pulse,
  FireCommand,
  PulseOf,
  CanvasContext,
]

function add_simulation_systems(schedule: SystemSchedule) {
  g.add_system(schedule, movement_system)
  g.add_system(schedule, pulse_spawner_system)
  g.add_system(schedule, pulse_system)
  g.add_system(schedule, attached_pulse_system)
}

const pulse_spawner_system = g.define_system(
  (
    query: All<
      typeof g.Entity,
      Read<typeof Position>,
      Rel<typeof g.CommandOf, Has<typeof FireCommand>>
    >,
    world: World,
  ) => {
    for (const [player_ent, pos] of query) {
      // Find the intent tick from the command entity
      const incoming = world.relations.object_to_subjects.get(player_ent)
      let intent_tick = world.tick
      if (incoming) {
        for (const { subject, relation_id } of incoming) {
          if (relation_id === world.component_registry.get_id(g.CommandOf)) {
            const it = g.get_component_value(
              world,
              subject as Entity,
              g.IntentTick,
            )
            if (it !== undefined) {
              intent_tick = it
              break
            }
          }
        }
      }

      // Predict spawn into Local Domain (will be Domain 1 on client, Domain 0 on server)
      g.spawn(
        world,
        [Position(pos), Pulse(5), PulseOf(player_ent), g.Replicated],
        world.registry.hi,
        intent_tick,
      )
    }
  },
  {
    params: [
      g.All(g.Entity, g.Read(Position), g.Rel(g.CommandOf, g.Has(FireCommand))),
      g.WorldTerm(),
    ],
    name: "pulse_spawner_system",
  },
)

const movement_system = g.define_system(
  (
    query: All<
      typeof g.Entity,
      Read<typeof Position>,
      Rel<typeof g.CommandOf, Read<typeof MoveCommand>>
    >,
    update: Add<typeof Position>,
  ) => {
    for (const [entity, pos, move] of query) {
      let next_x = pos.x + move.dx * SPEED
      let next_y = pos.y + move.dy * SPEED

      // Wrap around canvas
      if (next_x < 0) next_x = 400
      if (next_x > 400) next_x = 0
      if (next_y < 0) next_y = 400
      if (next_y > 400) next_y = 0

      update(entity, { x: next_x, y: next_y })
    }
  },
  {
    params: [
      g.All(
        g.Entity,
        g.Read(Position),
        g.Rel(g.CommandOf, g.Read(MoveCommand)),
      ),
      g.Add(Position),
    ],
    name: "movement_system",
  },
)

const pulse_system = g.define_system(
  (
    query: All<typeof g.Entity, Read<typeof Pulse>>,
    update: Add<typeof Pulse>,
    despawn: g.Despawn,
  ) => {
    for (const [entity, size] of query) {
      const next_size = (size as number) + 1.5
      if (next_size > 40) {
        despawn(entity)
      } else {
        update(entity, next_size)
      }
    }
  },
  {
    params: [g.All(g.Entity, g.Read(Pulse)), g.Add(Pulse), g.Despawn()],
    name: "pulse_system",
  },
)

const attached_pulse_system = g.define_system(
  (
    pulses: All<
      typeof g.Entity,
      Read<typeof Position>,
      Rel<typeof PulseOf, Read<typeof Position>>
    >,
    update: Add<typeof Position>,
  ) => {
    for (const [pulse_ent, _pos, parent_pos] of pulses) {
      update(pulse_ent, { x: parent_pos.x, y: parent_pos.y })
    }
  },
  {
    params: [
      g.All(g.Entity, g.Read(Position), g.Rel(PulseOf, g.Read(Position))),
      g.Add(Position),
    ],
    name: "attached_pulse_system",
  },
)

const render_system = g.define_system(
  (
    query: All<Read<typeof Position>, Read<typeof Color>>,
    pulses: All<Read<typeof Position>, Read<typeof Pulse>>,
    ctx: Write<typeof CanvasContext>,
  ) => {
    ctx.fillStyle = "black"
    ctx.fillRect(0, 0, 400, 400)

    for (const [pos, color_id] of query) {
      ctx.fillStyle = (color_id as number) === 0 ? "#61dafb" : "#ff4444" // Server blue vs client red
      ctx.fillRect(pos.x - 10, pos.y - 10, 20, 20)
    }

    ctx.strokeStyle = "yellow"
    ctx.lineWidth = 2
    for (const [pos, size] of pulses) {
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, size as number, 0, Math.PI * 2)
      ctx.stroke()
    }
  },
  {
    params: [
      g.All(g.Read(Position), g.Read(Color)),
      g.All(g.Read(Position), g.Read(Pulse)),
      g.Write(CanvasContext),
    ],
    name: "render_system",
  },
)

// 4. Server Setup
function create_server() {
  const canvas = document.getElementById("canvasServer") as HTMLCanvasElement
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D
  const world = g.make_world(0, schema) as World
  const schedule = g.make_system_schedule()
  const timestep = g.make_timestep(HZ)

  g.add_resource(world, CanvasContext(ctx))
  g.add_resource(
    world,
    g.ReplicationConfig({
      history_window: 64,
    }),
  )

  // Server Orchestration
  g.add_system(schedule, reconciliation.apply_remote_transactions)
  g.add_system(schedule, commands.spawn_ephemeral_commands)
  add_simulation_systems(schedule)
  g.add_system(schedule, render_system)
  g.add_system(schedule, commands.cleanup_ephemeral_commands)
  g.add_system(schedule, replication.commit_pending_mutations)
  g.add_system(schedule, replication.advance_world_tick)
  g.add_system(schedule, replication.prune_temporal_buffers)

  return { world, schedule, timestep }
}

// 5. Client Setup
function create_client(hi: number, reconcile_schedule: SystemSchedule) {
  const canvas = document.getElementById("canvasClient") as HTMLCanvasElement
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D
  const world = g.make_world(hi, schema) as World
  const timestep = g.make_timestep(HZ)

  // Initialize history for reconciliation (Rollback Buffer)
  world.history = g.make_history_buffer(120)

  const schedule = g.make_system_schedule()

  g.add_resource(world, CanvasContext(ctx))
  g.add_resource(
    world,
    g.ReplicationConfig({
      history_window: 64,
      ghost_cleanup_window: 60,
      simulation_schedule: reconcile_schedule,
    }),
  )

  // Client Orchestration
  g.add_system(schedule, reconciliation.perform_rollback)
  g.add_system(schedule, reconciliation.cleanup_ghosts)
  g.add_system(schedule, commands.spawn_ephemeral_commands)
  add_simulation_systems(schedule)
  g.add_system(schedule, reconciliation.apply_remote_transactions)
  g.add_system(schedule, render_system)
  g.add_system(schedule, commands.cleanup_ephemeral_commands)
  g.add_system(schedule, replication.commit_pending_mutations)
  g.add_system(schedule, replication.advance_world_tick)
  g.add_system(schedule, replication.prune_temporal_buffers)

  const active_keys = new Set<string>()
  const just_pressed = new Set<string>()
  window.addEventListener("keydown", (e) => {
    if (!active_keys.has(e.code)) {
      just_pressed.add(e.code)
    }
    active_keys.add(e.code)
  })
  window.addEventListener("keyup", (e) => active_keys.delete(e.code))

  return {
    world,
    schedule,
    active_keys,
    just_pressed,
    timestep,
    is_synced: false,
  }
}

// 6. Main Logic
const server = create_server()

// Pre-create sub-schedule for reconciliation
const reconcile_schedule = g.make_system_schedule()
g.add_system(reconcile_schedule, commands.spawn_ephemeral_commands)
add_simulation_systems(reconcile_schedule)
g.add_system(reconcile_schedule, commands.cleanup_ephemeral_commands)

const client = create_client(1, reconcile_schedule)

// Artificial latency pipes
const client_to_server = [] as { time: number; packet: Uint8Array }[]
const server_to_client = [] as { time: number; packet: Uint8Array }[]

// Server broadcasts transactions to client
server.world.recorder = (tx) => {
  const writer = new g.ByteWriter()
  g.write_transaction(writer, tx, server.world)
  server_to_client.push({
    time: performance.now() + LATENCY_MS,
    packet: writer.get_bytes(),
  })
}

// Spawn the player on the server AFTER the recorder is established
const player = g.spawn(server.world, [
  Position({ x: 200, y: 200 }),
  Color(0),
  g.Replicated,
])

// HANDSHAKE: Server sends initial tick to client
{
  const writer = new g.ByteWriter()
  g.write_handshake_server(writer, server.world.tick, {
    domain_id: 0, // Server domain
    tick: server.world.tick,
  })
  server_to_client.push({
    time: performance.now() + LATENCY_MS,
    packet: writer.get_bytes(),
  })
}

// Simulation loop
function loop() {
  const now = performance.now()

  if (!client.is_synced) {
    // Repeatedly send handshake until client syncs
    const writer = new g.ByteWriter()
    g.write_handshake_server(writer, server.world.tick, {
      domain_id: 1,
      tick: server.world.tick,
    })
    server_to_client.push({
      time: now + LATENCY_MS,
      packet: writer.get_bytes(),
    })
  }

  // 1. Process Client -> Server (Commands)
  while (client_to_server.length > 0 && client_to_server[0].time <= now) {
    const { packet } = client_to_server.shift() as {
      time: number
      packet: Uint8Array
    }
    const reader = new g.ByteReader(packet)
    const header = g.read_message_header(reader)

    if (header.type === g.MessageType.Input) {
      const cmd_msg = g.read_commands(reader, header.tick, server.world)
      // Server applies commands to the tick they were meant for.
      // If the tick has already passed, we apply it to the NEXT server tick
      // to avoid missing it in the current schedule run.
      const target_tick = Math.max(server.world.tick, cmd_msg.tick)

      for (const cmd of cmd_msg.commands) {
        g.record_command(
          server.world,
          cmd.target as Entity,
          {
            component: {
              id: cmd.component_id,
              __component_brand: true,
            } as unknown as Component<unknown>,
            value: cmd.data,
          },
          target_tick,
          cmd_msg.tick, // Original intent tick
        )
      }
    }
  }

  // 2. Process Server -> Client (Handshake & Sync)
  while (server_to_client.length > 0 && server_to_client[0].time <= now) {
    const { packet } = server_to_client.shift() as {
      time: number
      packet: Uint8Array
    }
    const reader = new g.ByteReader(packet)
    const header = g.read_message_header(reader)

    if (header.type === g.MessageType.Handshake) {
      const handshake = g.read_handshake_server(reader)

      // Calculate target lead time
      const latency_ticks = Math.ceil(LATENCY_MS / (1000 / HZ))
      const target_tick =
        handshake.tick + LAG_COMPENSATION_TICKS + latency_ticks

      if (!client.is_synced) {
        client.world.tick = target_tick
        client.is_synced = true
        client.timestep.last_time = now
        client.timestep.accumulated = 0
        if (client.world.history) {
          g.push_snapshot(client.world, client.world.history)
        }
      } else {
        // Continuous adjustment: slightly speed up or slow down to maintain target
        const drift = client.world.tick - target_tick
        if (Math.abs(drift) > 2) {
          // If drift is too large, snap it (heavy jitter or tab backgrounded)
          client.world.tick = target_tick
        } else if (drift > 0) {
          // Client is too far ahead, skip an accumulation to slow down
          client.timestep.accumulated -= 1
        } else if (drift < 0) {
          // Client is falling behind, add accumulation to speed up
          client.timestep.accumulated += 1
        }
      }

      if (client.world.tick % 60 === 0) {
        console.log(
          `Sync: Server=${handshake.tick}, Client=${client.world.tick}, Drift=${client.world.tick - handshake.tick}`,
        )
      }
    } else if (header.type === g.MessageType.Transaction) {
      const tx = g.read_transaction(reader, header.tick, client.world)
      g.receive_transaction(client.world, tx)
    }
  }

  // 3. Update Client Prediction
  if (client.is_synced) {
    g.timestep_update(client.timestep, now, () => {
      let dx = 0,
        dy = 0
      if (client.active_keys.has("KeyW")) dy -= 1
      if (client.active_keys.has("KeyS")) dy += 1
      if (client.active_keys.has("KeyA")) dx -= 1
      if (client.active_keys.has("KeyD")) dx += 1

      if (dx !== 0 || dy !== 0) {
        g.record_command(client.world, player, MoveCommand({ dx, dy }))
      }

      if (client.just_pressed.has("Space")) {
        g.record_command(client.world, player, FireCommand)
        client.just_pressed.delete("Space")
      }

      // Clear just_pressed after the simulation tick(s)
      client.just_pressed.clear()

      const commands = client.world.command_buffer.get(client.world.tick)
      if (commands && commands.length > 0) {
        const writer = new g.ByteWriter()
        g.write_commands(
          writer,
          { tick: client.world.tick, commands },
          client.world,
        )
        client_to_server.push({
          time: performance.now() + LATENCY_MS,
          packet: writer.get_bytes(),
        })
      }

      g.run_schedule(client.schedule, client.world as World)
    })
  }

  // 4. Update Server
  g.timestep_update(server.timestep, now, () => {
    g.run_schedule(server.schedule, server.world as World)
  })

  // 5. Update Status
  const client_player_pos = g.get_component_value(
    client.world as World,
    player,
    Position,
  )
  const server_player_pos = g.get_component_value(
    server.world as World,
    player,
    Position,
  )

  const drift = client.world.tick - server.world.tick

  const status_el = document.getElementById("status")
  if (status_el) {
    status_el.innerText =
      `Latency: ${LATENCY_MS}ms | Drift: ${drift} ticks | ` +
      `Server Tick: ${server.world.tick} (${server_player_pos ? Math.round(server_player_pos.x) : "?"}, ${server_player_pos ? Math.round(server_player_pos.y) : "?"}) | ` +
      `Client Tick: ${client.world.tick} (${client_player_pos ? Math.round(client_player_pos.x) : "?"}, ${client_player_pos ? Math.round(client_player_pos.y) : "?"})`
  }

  requestAnimationFrame(loop)
}

loop()
