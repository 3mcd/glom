# Server-Authoritative Architecture

This guide explains how to structure a networked application where a server has authority over the simulation. This model prevents cheating and ensures all participants see a consistent state, while using prediction to keep the experience responsive for players.

## Core Workflow

A server-authoritative app follows a specific loop for both the client and the server:

1.  **Client** records user intent as commands.
2.  **Client** predicts the result of these commands immediately.
3.  **Client** sends commands to the **Server**.
4.  **Server** validates and executes commands in its own simulation.
5.  **Server** broadcasts the resulting state changes back to all **Clients**.
6.  **Client** reconciles its predicted state with the authoritative state from the server.

## 1. Shared Simulation

Both the client and the server should run the same simulation logic. This ensures that the client's prediction matches the server's eventual result.

```typescript
function add_simulation_systems(schedule: g.SystemSchedule) {
  g.add_system(schedule, movement_system)
  g.add_system(schedule, combat_system)
}
```

## 2. Defining Commands

Commands are components that represent user intent. They are often "ephemeral," meaning they exist only for a single tick.

```typescript
const MoveCommand = g.define_component<{dx: number; dy: number}>({
  // ... encode/decode for networking ...
})
```

## 3. Server Setup

The server is responsible for receiving commands and broadcasting state. It uses the `ReplicationStream` resource to track what needs to be sent to clients.

```typescript
const world = g.make_world({domain_id: 0, schema})
const schedule = g.make_system_schedule()

// Configure replication
g.add_resource(world, g.ReplicationConfig({ history_window: 64 }))
g.add_resource(world, g.ReplicationStream({ transactions: [], snapshots: [] }))
g.add_resource(world, g.CommandBuffer(new Map()))

// Standard server schedule order:
g.add_system(schedule, g.clear_replication_stream)
g.add_system(schedule, commands.spawn_ephemeral_commands)
add_simulation_systems(schedule)
g.add_system(schedule, commands.cleanup_ephemeral_commands)
g.add_system(schedule, replication.commit_pending_mutations)
g.add_system(schedule, replication.advance_world_tick)
```

## 4. Client Setup

The client needs a `history` buffer to store past states for reconciliation. It also requires a separate `reconcile_schedule` that only contains the simulation systems.

```typescript
const world = g.make_world({domain_id: 1, schema})
g.add_resource(world, g.HistoryBuffer({ snapshots: [], max_size: 120 }))
g.add_resource(world, g.CommandBuffer(new Map()))
g.add_resource(world, g.InputBuffer(new Map()))
g.add_resource(world, g.IncomingTransactions(new Map()))
g.add_resource(world, g.IncomingSnapshots(new Map()))

// The schedule used to "fast-forward" during reconciliation
const reconcile_schedule = g.make_system_schedule()
add_simulation_systems(reconcile_schedule)

g.add_resource(world, g.ReplicationConfig({
  history_window: 64,
  simulation_schedule: reconcile_schedule
}))

// Standard client schedule order:
g.add_system(schedule, reconciliation.perform_rollback)
g.add_system(schedule, commands.spawn_ephemeral_commands)
add_simulation_systems(schedule)
g.add_system(schedule, reconciliation.apply_remote_transactions)
g.add_system(schedule, commands.cleanup_ephemeral_commands)
g.add_system(schedule, replication.advance_world_tick)
```

## 5. Handling Input

On the client, use `record_command` to store intent for the current tick.

```typescript
// Inside the client loop
if (input.is_down("KeyW")) {
  g.record_command(world, player_entity, MoveCommand({dx: 0, dy: -1}))
}

// Send commands to server
const command_buffer = g.get_resource(world, g.CommandBuffer)
const commands = command_buffer?.get(world.tick)
if (commands) {
  const bytes = serialize_commands(world.tick, commands)
  network.send_to_server(bytes)
}
```

## 6. Reconciliation

When the client receives a transaction from the server, it uses `receive_transaction`. The `perform_rollback` system will then automatically detect if the server's state differs from what the client predicted. If it does, Glom will:

1.  **Roll back** the world state to the tick where the discrepancy occurred.
2.  **Re-simulate** every tick from that point up to the current predicted tick using the `simulation_schedule` and the local command history.
3.  **Apply** the corrected state, ensuring the player's view remains accurate to the server's authority.

