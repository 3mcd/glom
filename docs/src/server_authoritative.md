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
function addSimulationSystems(schedule: g.SystemSchedule) {
  g.addSystem(schedule, movementSystem)
  g.addSystem(schedule, combatSystem)
}
```

## 2. Defining Commands

Commands are components that represent user intent. They are often "ephemeral," meaning they exist only for a single tick.

```typescript
const MoveCommand = g.defineComponent<{dx: number; dy: number}>({
  // ... encode/decode for networking ...
})
```

## 3. Server Setup

The server is responsible for receiving commands and broadcasting state. It uses the `ReplicationStream` resource to track what needs to be sent to clients.

```typescript
const world = g.makeWorld({domainId: 0, schema})
const schedule = g.makeSystemSchedule()

// Configure replication
g.addResource(world, g.ReplicationConfig({ historyWindow: 64 }))
g.addResource(world, g.ReplicationStream({ transactions: [], snapshots: [] }))
g.addResource(world, g.CommandBuffer(new Map()))

// Standard server schedule order:
g.addSystem(schedule, g.clearReplicationStream)
g.addSystem(schedule, commands.spawnEphemeralCommands)
addSimulationSystems(schedule)
g.addSystem(schedule, commands.cleanupEphemeralCommands)
g.addSystem(schedule, replication.commitPendingMutations)
g.addSystem(schedule, replication.advanceWorldTick)
```

## 4. Client Setup

The client needs a `history` buffer to store past states for reconciliation. It also requires a separate `reconcileSchedule` that only contains the simulation systems.

```typescript
const world = g.makeWorld({domainId: 1, schema})
g.addResource(world, g.HistoryBuffer({ snapshots: [], maxSize: 120 }))
g.addResource(world, g.CommandBuffer(new Map()))
g.addResource(world, g.InputBuffer(new Map()))
g.addResource(world, g.IncomingTransactions(new Map()))
g.addResource(world, g.IncomingSnapshots(new Map()))

// The schedule used to "fast-forward" during reconciliation
const reconcileSchedule = g.makeSystemSchedule()
addSimulationSystems(reconcileSchedule)

g.addResource(world, g.ReplicationConfig({
  historyWindow: 64,
  simulationSchedule: reconcileSchedule
}))

// Standard client schedule order:
g.addSystem(schedule, reconciliation.performRollback)
g.addSystem(schedule, commands.spawnEphemeralCommands)
addSimulationSystems(schedule)
g.addSystem(schedule, reconciliation.applyRemoteTransactions)
g.addSystem(schedule, commands.cleanupEphemeralCommands)
g.addSystem(schedule, replication.advanceWorldTick)
```

## 5. Handling Input

On the client, use `recordCommand` to store intent for the current tick.

```typescript
// Inside the client loop
if (input.isDown("KeyW")) {
  g.recordCommand(world, playerEntity, MoveCommand({dx: 0, dy: -1}))
}

// Send commands to server
const commandBuffer = g.getResource(world, g.CommandBuffer)
const commands = commandBuffer?.get(world.tick)
if (commands) {
  const bytes = serializeCommands(world.tick, commands)
  network.sendToServer(bytes)
}
```

## 6. Reconciliation

When the client receives a transaction from the server, it uses `receiveTransaction`. The `performRollback` system will then automatically detect if the server's state differs from what the client predicted. If it does, Glom will:

1.  **Roll back** the world state to the tick where the discrepancy occurred.
2.  **Re-simulate** every tick from that point up to the current predicted tick using the `simulationSchedule` and the local command history.
3.  **Apply** the corrected state, ensuring the player's view remains accurate to the server's authority.

