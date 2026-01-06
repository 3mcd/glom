import * as g from "@glom/ecs"
import * as commands from "@glom/ecs/command"
import * as reconciliation from "@glom/ecs/reconciliation"
import * as replication from "@glom/ecs/replication"

const Position = g.define_component<{x: number; y: number}>({
  bytes_per_element: 16,
  encode: (val, writer) => {
    writer.write_float64(val.x)
    writer.write_float64(val.y)
  },
  decode: (reader) => {
    return {x: reader.read_float64(), y: reader.read_float64()}
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
  bytes_per_element: 16,
  encode: (val, writer) => {
    writer.write_float64(val.dx)
    writer.write_float64(val.dy)
  },
  decode: (reader) => {
    return {dx: reader.read_float64(), dy: reader.read_float64()}
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

function add_simulation_systems(schedule: g.SystemSchedule) {
  g.add_system(schedule, movement_system)
  g.add_system(schedule, pulse_spawner_system)
  g.add_system(schedule, pulse_system)
  g.add_system(schedule, attached_pulse_system)
}

const pulse_spawner_system = (
  query: g.All<
    g.Entity,
    g.Read<typeof Position>,
    g.Rel<typeof g.CommandOf, g.Has<typeof FireCommand>>
  >,
  world: g.World,
) => {
  for (const [player_ent, pos] of query) {
    const incoming = world.relations.object_to_subjects.get(player_ent)
    let intent_tick = world.tick
    if (incoming) {
      for (const {subject, relation_id} of incoming) {
        if (relation_id === world.component_registry.get_id(g.CommandOf)) {
          const it = g.get_component_value(
            world,
            subject as g.Entity,
            g.IntentTick,
          )
          if (it !== undefined) {
            intent_tick = it
            break
          }
        }
      }
    }

    g.spawn(
      world,
      [Position(pos), Pulse(5), PulseOf(player_ent), g.Replicated],
      world.registry.domain_id,
      intent_tick,
    )
  }
}

const movement_system = (
  query: g.All<
    g.Entity,
    g.Read<typeof Position>,
    g.Rel<typeof g.CommandOf, g.Read<typeof MoveCommand>>
  >,
  update: g.Add<typeof Position>,
) => {
  for (const [entity, pos, move] of query) {
    let next_x = pos.x + move.dx * SPEED
    let next_y = pos.y + move.dy * SPEED

    if (next_x < 0) next_x = 250
    if (next_x > 250) next_x = 0
    if (next_y < 0) next_y = 250
    if (next_y > 250) next_y = 0

    update(entity, {x: next_x, y: next_y})
  }
}

const pulse_system = (
  query: g.All<g.Entity, g.Read<typeof Pulse>>,
  update: g.Add<typeof Pulse>,
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
}

const attached_pulse_system = (
  pulses: g.All<
    g.Entity,
    g.Read<typeof Position>,
    g.Rel<typeof PulseOf, g.Read<typeof Position>>
  >,
  update: g.Add<typeof Position>,
) => {
  for (const [pulse_ent, _pos, parent_pos] of pulses) {
    update(pulse_ent, {x: parent_pos.x, y: parent_pos.y})
  }
}

const render_system = (
  query: g.All<g.Read<typeof Position>, g.Read<typeof Color>>,
  pulses: g.All<g.Read<typeof Position>, g.Read<typeof Pulse>>,
  ctx: g.Write<typeof CanvasContext>,
) => {
  ctx.fillStyle = "#0f0f0f" // --bg
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)

  for (const [pos, color_id] of query) {
    ctx.fillStyle = (color_id as number) === 0 ? "#aed7f5" : "#d6d4a6"
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

function create_server() {
  const canvas = document.getElementById("canvasServer") as HTMLCanvasElement
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D
  const world = g.make_world({domain_id: 0, schema}) as g.World
  const schedule = g.make_system_schedule()
  const timestep = g.make_timestep(HZ)

  g.add_resource(world, CanvasContext(ctx))
  g.add_resource(world, g.ReplicationConfig({history_window: 64}))
  g.add_resource(world, g.ReplicationStream({transactions: [], snapshots: []}))
  g.add_resource(world, g.CommandBuffer(new Map()))
  g.add_resource(world, g.IncomingTransactions(new Map()))
  g.add_resource(world, g.IncomingSnapshots(new Map()))

  g.add_system(schedule, g.clear_replication_stream)
  g.add_system(schedule, reconciliation.apply_remote_transactions)
  g.add_system(schedule, commands.spawn_ephemeral_commands)
  add_simulation_systems(schedule)
  g.add_system(schedule, render_system)
  g.add_system(schedule, commands.cleanup_ephemeral_commands)
  g.add_system(schedule, replication.commit_pending_mutations)
  g.add_system(schedule, replication.advance_world_tick)
  g.add_system(schedule, replication.prune_temporal_buffers)

  return {world, schedule, timestep}
}

function create_client(
  domain_id: number,
  reconcile_schedule: g.SystemSchedule,
) {
  const canvas = document.getElementById("canvasClient") as HTMLCanvasElement
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D
  const world = g.make_world({domain_id, schema}) as g.World
  const timestep = g.make_timestep(HZ)

  g.add_resource(world, g.HistoryBuffer({snapshots: [], max_size: 120}))
  g.add_resource(world, g.CommandBuffer(new Map()))
  g.add_resource(world, g.InputBuffer(new Map()))
  g.add_resource(world, g.IncomingTransactions(new Map()))
  g.add_resource(world, g.IncomingSnapshots(new Map()))

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
    if (!active_keys.has(e.code)) just_pressed.add(e.code)
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

const server = create_server()
const reconcile_schedule = g.make_system_schedule()
g.add_system(reconcile_schedule, commands.spawn_ephemeral_commands)
add_simulation_systems(reconcile_schedule)
g.add_system(reconcile_schedule, commands.cleanup_ephemeral_commands)

const client = create_client(1, reconcile_schedule)
const client_to_server = [] as {time: number; packet: Uint8Array}[]
const server_to_client = [] as {time: number; packet: Uint8Array}[]

const player = g.spawn(server.world, [
  Position({x: 125, y: 125}),
  Color(0),
  g.Replicated,
])

const writer = new g.ByteWriter()
g.write_handshake_server(writer, server.world.tick, {
  domain_id: 0,
  tick: server.world.tick,
})
server_to_client.push({
  time: performance.now() + LATENCY_MS,
  packet: writer.get_bytes(),
})

function loop() {
  const now = performance.now()

  if (!client.is_synced) {
    const writer = new g.ByteWriter()
    g.write_handshake_server(writer, server.world.tick, {
      domain_id: 1,
      tick: server.world.tick,
    })
    server_to_client.push({time: now + LATENCY_MS, packet: writer.get_bytes()})
  }

  while (client_to_server.length > 0 && client_to_server[0].time <= now) {
    const shift = client_to_server.shift()
    if (!shift) continue
    const {packet} = shift
    const reader = new g.ByteReader(packet)
    const header = g.read_message_header(reader)
    if (header.type === g.MessageType.Command) {
      const cmd_msg = g.read_commands(reader, header.tick, server.world)
      const target_tick = Math.max(server.world.tick, cmd_msg.tick)
      for (const cmd of cmd_msg.commands) {
        g.record_command(
          server.world,
          cmd.target as g.Entity,
          {
            component: {
              id: cmd.component_id,
              __component_brand: true,
            } as g.ComponentLike,
            value: cmd.data,
          },
          target_tick,
          cmd_msg.tick,
        )
      }
    }
  }

  while (server_to_client.length > 0 && server_to_client[0].time <= now) {
    const shift = server_to_client.shift()
    if (!shift) continue
    const {packet} = shift
    const reader = new g.ByteReader(packet)
    const header = g.read_message_header(reader)

    if (header.type === g.MessageType.Handshake) {
      const handshake = g.read_handshake_server(reader)
      const latency_ticks = Math.ceil(LATENCY_MS / (1000 / HZ))
      const target_tick =
        handshake.tick + LAG_COMPENSATION_TICKS + latency_ticks

      if (!client.is_synced) {
        client.world.tick = target_tick
        client.is_synced = true
        client.timestep.last_time = now
        client.timestep.accumulated = 0
        const history = g.get_resource(client.world, g.HistoryBuffer)
        if (history) g.push_snapshot(client.world, history)
      } else {
        const drift = client.world.tick - target_tick
        if (Math.abs(drift) > 2) client.world.tick = target_tick
        else if (drift > 0) client.timestep.accumulated -= 1
        else if (drift < 0) client.timestep.accumulated += 1
      }
    } else if (header.type === g.MessageType.Transaction) {
      const transaction = g.read_transaction(reader, header.tick, client.world)
      g.receive_transaction(client.world, transaction)
    }
  }

  if (client.is_synced) {
    g.timestep_update(client.timestep, now, () => {
      let dx = 0,
        dy = 0
      if (client.active_keys.has("KeyW")) dy -= 1
      if (client.active_keys.has("KeyS")) dy += 1
      if (client.active_keys.has("KeyA")) dx -= 1
      if (client.active_keys.has("KeyD")) dx += 1

      if (dx !== 0 || dy !== 0)
        g.record_command(client.world, player, MoveCommand({dx, dy}))
      if (client.just_pressed.has("Space")) {
        g.record_command(client.world, player, FireCommand)
        client.just_pressed.delete("Space")
      }
      client.just_pressed.clear()

      const command_buffer = g.get_resource(client.world, g.CommandBuffer)
      const commands = command_buffer?.get(client.world.tick)
      if (commands && commands.length > 0) {
        const writer = new g.ByteWriter()
        g.write_commands(
          writer,
          {tick: client.world.tick, commands},
          client.world,
        )
        client_to_server.push({
          time: performance.now() + LATENCY_MS,
          packet: writer.get_bytes(),
        })
      }
      g.run_schedule(client.schedule, client.world)
    })
  }

  g.timestep_update(server.timestep, now, () => {
    g.run_schedule(server.schedule, server.world)

    const stream = g.get_resource(server.world, g.ReplicationStream)
    if (stream) {
      for (const transaction of stream.transactions) {
        const writer = new g.ByteWriter()
        g.write_transaction(writer, transaction, server.world)
        server_to_client.push({
          time: performance.now() + LATENCY_MS,
          packet: writer.get_bytes(),
        })
      }
      for (const snap of stream.snapshots) {
        const writer = new g.ByteWriter()
        g.write_snapshot(writer, snap, server.world)
        server_to_client.push({
          time: performance.now() + LATENCY_MS,
          packet: writer.get_bytes(),
        })
      }
    }
  })

  const c_pos = g.get_component_value(client.world, player, Position)
  const s_pos = g.get_component_value(server.world, player, Position)
  const status = document.getElementById("status")
  if (status) {
    status.innerText =
      `Latency: ${LATENCY_MS}ms | Drift: ${client.world.tick - server.world.tick} ticks | ` +
      `Server: ${server.world.tick} (${s_pos ? Math.round(s_pos.x) : "?"}, ${s_pos ? Math.round(s_pos.y) : "?"}) | ` +
      `Client: ${client.world.tick} (${c_pos ? Math.round(c_pos.x) : "?"}, ${c_pos ? Math.round(c_pos.y) : "?"})`
  }

  requestAnimationFrame(loop)
}

loop()
