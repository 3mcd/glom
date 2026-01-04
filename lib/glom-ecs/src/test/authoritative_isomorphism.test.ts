import { expect, test } from "bun:test"
import * as g from "../index"

// 1. Component Definitions (mirrored from example)
const Position = g.define_component<{ x: number; y: number }>({
  bytes_per_element: 16,
  encode: (val, buf, off) => {
    const view = new DataView(buf.buffer, buf.byteOffset + off)
    view.setFloat64(0, val.x, true)
    view.setFloat64(8, val.y, true)
  },
  decode: (buf, off) => {
    const view = new DataView(buf.buffer, buf.byteOffset + off)
    return { x: view.getFloat64(0, true), y: view.getFloat64(8, true) }
  },
})

const MoveCommand = g.define_component<{ dx: number; dy: number }>({
  bytes_per_element: 16,
  encode: (val, buf, off) => {
    const view = new DataView(buf.buffer, buf.byteOffset + off)
    view.setFloat64(0, val.dx, true)
    view.setFloat64(8, val.dy, true)
  },
  decode: (buf, off) => {
    const view = new DataView(buf.buffer, buf.byteOffset + off)
    return { dx: view.getFloat64(0, true), dy: view.getFloat64(8, true) }
  },
})

const FireCommand = g.define_tag()
const Pulse = g.define_component<number>({
  bytes_per_element: 8,
  encode: (val, buf, off) => {
    new DataView(buf.buffer, buf.byteOffset + off).setFloat64(0, val, true)
  },
  decode: (buf, off) => {
    return new DataView(buf.buffer, buf.byteOffset + off).getFloat64(0, true)
  },
})
const PulseOf = g.define_relation()

const SPEED = 2

// 2. Systems
const movement_system = g.define_system(
  (
    query: g.All<
      g.Entity,
      g.Read<typeof Position>,
      g.Rel<typeof g.CommandOf, g.Read<typeof MoveCommand>>
    >,
    update: g.Add<typeof Position>,
  ) => {
    for (const [entity, pos, move] of query) {
      update(entity, { x: pos.x + move.dx * SPEED, y: pos.y + move.dy * SPEED })
    }
  },
  {
    params: [
      g.All(
        g.ENTITY,
        g.Read(Position),
        g.Rel(g.CommandOf, g.Read(MoveCommand)),
      ),
      g.Add(Position),
    ],
    name: "movement_system",
  },
)

const pulse_spawner_system = g.define_system(
  (
    query: g.All<
      g.Entity,
      g.Read<typeof Position>,
      g.Rel<typeof g.CommandOf, g.Has<typeof FireCommand>>
    >,
    world: g.World,
  ) => {
    for (const [player_ent, pos] of query) {
      // Find the intent tick from the command entity
      let intent_tick = world.tick
      const node = g.sparse_map_get(
        world.entity_graph.by_entity,
        player_ent as number,
      )
      if (node) {
        for (const comp of node.vec.elements) {
          const comp_id = world.component_registry.get_id(comp)
          const rel = world.relations.virtual_to_rel.get(comp_id)
          if (
            rel &&
            rel.relation_id === world.component_registry.get_id(g.CommandOf)
          ) {
            const cmd_ent = rel.object as g.Entity
            const cmd_node = g.sparse_map_get(
              world.entity_graph.by_entity,
              cmd_ent as number,
            )
            const fire_command_id = world.component_registry.get_id(FireCommand)
            if (
              cmd_node?.vec.elements.some(
                (c) => world.component_registry.get_id(c) === fire_command_id,
              )
            ) {
              const it = g.get_component_value(world, cmd_ent, g.IntentTick)
              if (it !== undefined) {
                intent_tick = it
                break
              }
            }
          }
        }
      }

      g.spawn(
        world,
        [Position({ ...pos }), Pulse(5), PulseOf(player_ent), g.Replicated],
        world.registry.hi,
        intent_tick,
      )
    }
  },
  {
    params: [
      g.All(g.ENTITY, g.Read(Position), g.Rel(g.CommandOf, g.Has(FireCommand))),
      g.WorldTerm(),
    ],
    name: "pulse_spawner_system",
  },
)

const attached_pulse_system = g.define_system(
  (
    pulses: g.All<
      g.Entity,
      g.Read<typeof Position>,
      g.Rel<typeof PulseOf, g.Read<typeof Position>>
    >,
    update: g.Add<typeof Position>,
  ) => {
    for (const [pulse_ent, _pos, parent_pos] of pulses) {
      update(pulse_ent, { x: parent_pos.x, y: parent_pos.y })
    }
  },
  {
    params: [
      g.All(g.ENTITY, g.Read(Position), g.Rel(PulseOf, g.Read(Position))),
      g.Add(Position),
    ],
    name: "attached_pulse_system",
  },
)

const schema = [Position, MoveCommand, FireCommand, Pulse, PulseOf]

// 3. Mock Network Pipe
class MockPipe {
  private messages: { delivery_tick: number; packet: Uint8Array }[] = []

  send(packet: Uint8Array, current_tick: number, delay_ticks: number) {
    this.messages.push({
      delivery_tick: current_tick + delay_ticks,
      packet: new Uint8Array(packet),
    })
  }

  receive(current_tick: number): Uint8Array[] {
    const ready = this.messages.filter((m) => m.delivery_tick <= current_tick)
    this.messages = this.messages.filter((m) => m.delivery_tick > current_tick)
    return ready.map((m) => m.packet)
  }
}

// 4. Test Harness Setup
function setup_server() {
  const world = g.make_world(0, schema)
  const schedule = g.make_system_schedule()

  g.add_resource(
    world,
    g.ReplicationConfig({
      history_window: 64,
    }),
  )

  g.add_system(schedule, g.GlomNetwork.reconcile.apply_remote_transactions)
  g.add_system(schedule, g.GlomNetwork.commands.spawn_ephemeral_commands)
  g.add_system(schedule, movement_system)
  g.add_system(schedule, pulse_spawner_system)
  g.add_system(schedule, attached_pulse_system)
  g.add_system(schedule, g.GlomNetwork.commands.cleanup_ephemeral_commands)
  g.add_system(schedule, g.GlomNetwork.replicate.commit_pending_mutations)
  g.add_system(schedule, g.GlomNetwork.replicate.advance_world_tick)

  return { world, schedule }
}

function setup_client(hi: number) {
  const world = g.make_world(hi, schema)
  world.history = { snapshots: [], max_size: 120 }

  const reconcile_schedule = g.make_system_schedule()
  g.add_system(
    reconcile_schedule,
    g.GlomNetwork.commands.spawn_ephemeral_commands,
  )
  g.add_system(reconcile_schedule, movement_system)
  g.add_system(reconcile_schedule, pulse_spawner_system)
  g.add_system(reconcile_schedule, attached_pulse_system)
  g.add_system(
    reconcile_schedule,
    g.GlomNetwork.commands.cleanup_ephemeral_commands,
  )

  const schedule = g.make_system_schedule()

  g.add_resource(
    world,
    g.ReplicationConfig({
      history_window: 64,
      ghost_cleanup_window: 20,
      simulation_schedule: reconcile_schedule,
    }),
  )

  g.add_system(schedule, g.GlomNetwork.reconcile.perform_rollback)
  g.add_system(schedule, g.GlomNetwork.reconcile.cleanup_ghosts)
  g.add_system(schedule, g.GlomNetwork.commands.spawn_ephemeral_commands)
  g.add_system(schedule, movement_system)
  g.add_system(schedule, pulse_spawner_system)
  g.add_system(schedule, attached_pulse_system)
  g.add_system(schedule, g.GlomNetwork.reconcile.apply_remote_transactions)
  g.add_system(schedule, g.GlomNetwork.commands.cleanup_ephemeral_commands)
  g.add_system(schedule, g.GlomNetwork.replicate.commit_pending_mutations)
  g.add_system(schedule, g.GlomNetwork.replicate.advance_world_tick)

  return { world, schedule }
}

// 5. Integration Tests
test("rigorous straight-line movement isomorphism", () => {
  const server = setup_server()
  const client = setup_client(1)
  const client_to_server = new MockPipe()
  const server_to_client = new MockPipe()
  const LATENCY_TICKS = 5

  // Recorder: Server -> Client
  server.world.recorder = (tx) => {
    const writer = new g.ByteWriter()
    g.write_transaction(writer, tx, server.world)
    server_to_client.send(writer.get_bytes(), server.world.tick, LATENCY_TICKS)
  }

  // Spawn player on server
  const player = g.spawn(server.world, [Position({ x: 0, y: 0 }), g.Replicated])

  // Initial Sync: Server sends handshake
  const handshake_writer = new g.ByteWriter()
  g.write_handshake_server(handshake_writer, server.world.tick, {
    domain_id: 0,
    tick: server.world.tick,
  })
  server_to_client.send(handshake_writer.get_bytes(), 0, LATENCY_TICKS)

  let client_synced = false
  const server_positions: Map<number, { x: number; y: number }> = new Map()
  const predicted_positions: Map<number, { x: number; y: number }> = new Map()

  // Run for 200 ticks
  for (let tick = 0; tick < 200; tick++) {
    // --- SERVER STEP ---
    for (const packet of client_to_server.receive(server.world.tick)) {
      const reader = new g.ByteReader(packet)
      const header = g.read_message_header(reader)
      if (header.type === g.MessageType.Input) {
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
              } as g.Component<unknown>,
              value: cmd.data,
            },
            target_tick,
            cmd_msg.tick,
          )
        }
      }
    }

    // Capture state AT START of tick
    const s_pos_before = g.get_component_value(server.world, player, Position)
    if (s_pos_before) {
      server_positions.set(server.world.tick, { ...s_pos_before })
    }

    g.run_schedule(server.schedule, server.world as g.World)

    // --- CLIENT STEP ---
    for (const packet of server_to_client.receive(tick)) {
      const reader = new g.ByteReader(packet)
      const header = g.read_message_header(reader)
      if (header.type === g.MessageType.Handshake) {
        const handshake = g.read_handshake_server(reader)
        if (!client_synced) {
          // Client needs a lead time greater than the round-trip latency
          client.world.tick = handshake.tick + LATENCY_TICKS * 3
          // Capture initial snapshot
          if (client.world.history) {
            g.push_snapshot(client.world, client.world.history)
          }
          client_synced = true
        }
      } else if (header.type === g.MessageType.Transaction) {
        const tx = g.read_transaction(reader, header.tick, server.world)
        g.receive_transaction(client.world, tx)
      }
    }

    if (client_synced) {
      g.record_command(client.world, player, MoveCommand({ dx: 1, dy: 0 }))

      const commands = client.world.command_buffer.get(client.world.tick)
      if (commands) {
        const writer = new g.ByteWriter()
        g.write_commands(
          writer,
          { tick: client.world.tick, commands },
          server.world,
        )
        client_to_server.send(writer.get_bytes(), tick, LATENCY_TICKS)
      }

      // Capture prediction BEFORE simulation
      const c_pos_before = g.get_component_value(client.world, player, Position)
      if (c_pos_before) {
        predicted_positions.set(client.world.tick, { ...c_pos_before })
      }

      g.run_schedule(client.schedule, client.world as g.World)

      // Verification: Does the RECONCILED state for a past tick match the server?
      const check_tick = tick - LATENCY_TICKS
      if (check_tick >= 0) {
        const s_pos = server_positions.get(check_tick)
        // Look up the corrected snapshot in client history
        const snapshot = client.world.history?.snapshots.find(
          (s) => s.tick === check_tick,
        )

        if (s_pos && snapshot) {
          const player_idx = snapshot.entity_to_index.get(player)
          const pos_store = snapshot.component_data.get(
            client.world.component_registry.get_id(Position),
          )
          if (player_idx !== undefined && pos_store) {
            const reconciled_pos = pos_store[player_idx] as {
              x: number
              y: number
            }
            expect(reconciled_pos.x).toBeCloseTo(s_pos.x)
            expect(reconciled_pos.y).toBeCloseTo(s_pos.y)
          }
        }
      }
    }
  }
})

test("stop-and-go movement isomorphism", () => {
  const server = setup_server()
  const client = setup_client(1)
  const client_to_server = new MockPipe()
  const server_to_client = new MockPipe()
  const LATENCY_TICKS = 5

  server.world.recorder = (tx) => {
    const writer = new g.ByteWriter()
    g.write_transaction(writer, tx, server.world)
    server_to_client.send(writer.get_bytes(), server.world.tick, LATENCY_TICKS)
  }

  const player = g.spawn(server.world, [Position({ x: 0, y: 0 }), g.Replicated])

  const handshake_writer = new g.ByteWriter()
  g.write_handshake_server(handshake_writer, server.world.tick, {
    domain_id: 0,
    tick: server.world.tick,
  })
  server_to_client.send(handshake_writer.get_bytes(), 0, LATENCY_TICKS)

  let client_synced = false
  const server_positions: Map<number, { x: number; y: number }> = new Map()
  const predicted_positions: Map<number, { x: number; y: number }> = new Map()

  for (let tick = 0; tick < 200; tick++) {
    // SERVER
    for (const packet of client_to_server.receive(server.world.tick)) {
      const reader = new g.ByteReader(packet)
      const header = g.read_message_header(reader)
      if (header.type === g.MessageType.Input) {
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
              } as g.Component<unknown>,
              value: cmd.data,
            },
            target_tick,
            cmd_msg.tick,
          )
        }
      }
    }
    const s_pos_before = g.get_component_value(server.world, player, Position)
    if (s_pos_before) {
      server_positions.set(server.world.tick, { ...s_pos_before })
    }
    g.run_schedule(server.schedule, server.world as g.World)

    // CLIENT
    for (const packet of server_to_client.receive(tick)) {
      const reader = new g.ByteReader(packet)
      const header = g.read_message_header(reader)
      if (header.type === g.MessageType.Handshake) {
        const handshake = g.read_handshake_server(reader)
        if (!client_synced) {
          client.world.tick = handshake.tick + LATENCY_TICKS * 3
          client_synced = true
        }
      } else if (header.type === g.MessageType.Transaction) {
        const tx = g.read_transaction(reader, header.tick, server.world)
        g.receive_transaction(client.world, tx)
      }
    }

    if (client_synced) {
      // Move only between tick 50 and 100
      if (tick >= 50 && tick < 100) {
        g.record_command(client.world, player, MoveCommand({ dx: 1, dy: 0 }))
      }

      const commands = client.world.command_buffer.get(client.world.tick)
      if (commands) {
        const writer = new g.ByteWriter()
        g.write_commands(
          writer,
          { tick: client.world.tick, commands },
          server.world,
        )
        client_to_server.send(writer.get_bytes(), tick, LATENCY_TICKS)
      }

      const c_pos_before = g.get_component_value(client.world, player, Position)
      if (c_pos_before) {
        predicted_positions.set(client.world.tick, { ...c_pos_before })
      }

      g.run_schedule(client.schedule, client.world as g.World)

      // Verification: Does the RECONCILED state for a past tick match the server?
      const check_tick = tick - LATENCY_TICKS
      if (check_tick >= 0) {
        const s_pos = server_positions.get(check_tick)
        // Look up the corrected snapshot in client history
        const snapshot = client.world.history?.snapshots.find(
          (s) => s.tick === check_tick,
        )

        if (s_pos && snapshot) {
          const player_idx = snapshot.entity_to_index.get(player)
          const pos_store = snapshot.component_data.get(
            client.world.component_registry.get_id(Position),
          )
          if (player_idx !== undefined && pos_store) {
            const reconciled_pos = pos_store[player_idx] as {
              x: number
              y: number
            }
            expect(reconciled_pos.x).toBeCloseTo(s_pos.x)
            expect(reconciled_pos.y).toBeCloseTo(s_pos.y)
          }
        }
      }
    }
  }
})

test("predictive spawning and rebinding isomorphism", () => {
  const server = setup_server()
  const client = setup_client(1)
  const client_to_server = new MockPipe()
  const server_to_client = new MockPipe()
  const LATENCY_TICKS = 5

  server.world.recorder = (tx) => {
    const writer = new g.ByteWriter()
    g.write_transaction(writer, tx, server.world)
    server_to_client.send(writer.get_bytes(), server.world.tick, LATENCY_TICKS)
  }

  const player = g.spawn(server.world, [Position({ x: 0, y: 0 }), g.Replicated])

  const handshake_writer = new g.ByteWriter()
  g.write_handshake_server(handshake_writer, server.world.tick, {
    domain_id: 0,
    tick: server.world.tick,
  })
  server_to_client.send(
    handshake_writer.get_bytes(),
    server.world.tick,
    LATENCY_TICKS,
  )

  let client_synced = false
  let spawn_triggered = false

  for (let tick = 0; tick < 100; tick++) {
    // SERVER
    for (const packet of client_to_server.receive(server.world.tick)) {
      const reader = new g.ByteReader(packet)
      const header = g.read_message_header(reader)
      if (header.type === g.MessageType.Input) {
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
              } as g.Component<unknown>,
              value: cmd.data,
            },
            target_tick,
            cmd_msg.tick,
          )
        }
      }
    }
    g.run_schedule(server.schedule, server.world as g.World)

    // CLIENT
    for (const packet of server_to_client.receive(tick)) {
      const reader = new g.ByteReader(packet)
      const header = g.read_message_header(reader)
      if (header.type === g.MessageType.Handshake) {
        const handshake = g.read_handshake_server(reader)
        if (!client_synced) {
          client.world.tick = handshake.tick + LATENCY_TICKS + 1
          client_synced = true
        }
      } else if (header.type === g.MessageType.Transaction) {
        const tx = g.read_transaction(reader, header.tick, server.world)
        g.receive_transaction(client.world, tx)
      }
    }

    if (client_synced) {
      if (!spawn_triggered && tick > 20) {
        g.record_command(client.world, player, FireCommand)
        spawn_triggered = true
      }

      const commands = client.world.command_buffer.get(client.world.tick)
      if (commands) {
        const writer = new g.ByteWriter()
        g.write_commands(
          writer,
          { tick: client.world.tick, commands },
          server.world,
        )
        client_to_server.send(
          writer.get_bytes(),
          client.world.tick,
          LATENCY_TICKS,
        )
      }

      g.run_schedule(client.schedule, client.world as g.World)

      // Verify that we don't have double pulses
      const pulse_entities = client.world.index.entity_to_index.indices.filter(
        (e) => {
          return (
            g.get_component_value(client.world, e as g.Entity, Pulse) !==
            undefined
          )
        },
      )

      if (pulse_entities.length > 1) {
        console.log(`Double pulse detected at client tick ${client.world.tick}`)
        for (const e of pulse_entities) {
          const node = g.sparse_map_get(
            client.world.entity_graph.by_entity,
            e as number,
          )
          console.log(
            `  Entity ${e}: hi=${g.get_hi(e as g.Entity)}, lo=${g.get_lo(e as g.Entity)}, replicated=${node?.vec.elements.some((c) => client.world.component_registry.get_id(c) === g.Replicated.id)}`,
          )
        }
      }

      // At most 1 pulse should exist if rebinding is working
      expect(pulse_entities.length).toBeLessThanOrEqual(1)
    }
  }
})
