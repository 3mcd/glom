# Server-Authoritative Architecture

This guide explains how to structure a networked application where a server has authority over the world state. This model prevents cheating and ensures all participants see a consistent state, while using prediction to keep the experience responsive for players.

## Core Workflow

A server-authoritative app follows a specific loop for both the client and the server:

1.  **Client** records user intent as commands.
2.  **Client** predicts the result of these commands immediately.
3.  **Client** sends commands to the **Server**.
4.  **Server** validates and executes commands in its own world.
5.  **Server** broadcasts the resulting state changes back to all **Clients**.
6.  **Client** reconciles its predicted state with the authoritative state from the server.

## 1. Shared Logic

Both the client and the server should run the same logic. This ensures that the client's prediction matches the server's eventual result.

```typescript
function addLogicalSystems(schedule: SystemSchedule) {
  addSystem(schedule, movementSystem)
  addSystem(schedule, combatSystem)
}
```

## 2. Defining Commands

Commands are components that represent user intent. They are often "ephemeral," meaning they exist only for a single tick.

```typescript
const MoveCommand = defineComponent<{dx: number; dy: number}>({
  // ... encode/decode for networking ...
})
```

## 3. Server Setup

The server is responsible for receiving commands and broadcasting state. It uses the `ReplicationStream` resource to track what needs to be sent to clients.

```typescript
const world = makeWorld({ schema })
const schedule = makeSystemSchedule()

// configure replication
addResource(world, ReplicationConfig({ historyWindow: 64 }))
addResource(world, ReplicationStream({ transactions: [], snapshots: [] }))
addResource(world, CommandBuffer(new Map()))

// standard server schedule order:
addSystem(schedule, clearReplicationStream)
addSystem(schedule, commands.spawnEphemeralCommands)
addLogicalSystems(schedule)
addSystem(schedule, commands.cleanupEphemeralCommands)
addSystem(schedule, replication.commitPendingMutations)
addSystem(schedule, replication.advanceWorldTick)
```

## 4. Client Setup

The client needs a `history` buffer to store past states for reconciliation. It also requires a separate `reconcileSchedule` that contains the same logical systems the server runs.

```typescript
const world = makeWorld({domainId: 1, schema})
addResource(world, HistoryBuffer({ snapshots: [], maxSize: 120 }))
addResource(world, CommandBuffer(new Map()))
addResource(world, InputBuffer(new Map()))
addResource(world, IncomingTransactions(new Map()))
addResource(world, IncomingSnapshots(new Map()))

// the schedule used to "fast-forward" during reconciliation
const reconcileSchedule = makeSystemSchedule()
addLogicalSystems(reconcileSchedule)

addResource(world, ReplicationConfig({
  historyWindow: 64,
  reconcileSchedule: reconcileSchedule
}))

// standard client schedule order:
addSystem(schedule, reconciliation.performRollback)
addSystem(schedule, commands.spawnEphemeralCommands)
addLogicalSystems(schedule)
addSystem(schedule, reconciliation.applyRemoteTransactions)
addSystem(schedule, commands.cleanupEphemeralCommands)
addSystem(schedule, replication.advanceWorldTick)
```

## 5. Client Identification

When a client first connects, the server sends a `Handshake` message. This message contains the `domainId` assigned to the client and the server's current tick. The client must use this `domainId` to identify entities it creates locally (allowing the server to recognize them) and to sync its starting tick.

```typescript
// on the client, when receiving the initial handshake:
if (header.type === MessageType.Handshake) {
  const handshake = readHandshakeServer(reader)
  
  // estimate target tick: server tick + estimated round-trip buffer
  // (e., 100ms / 16ms = 6 ticks)
  const initialLatencyTicks = 6
  const targetTick = handshake.tick + initialLatencyTicks
  
  setDomainId(world, handshake.domainId)
  setTick(world, targetTick)
}
```

## 6. Clock Synchronization

Glom includes utilities for NTP-style clock synchronization to calculate the time offset between the client and server. This ensures that the client's `Timestep` runs in sync with the server's authoritative clock.

### The Sync Loop

1. **Request**: The client sends a `Clocksync` message with its current local time as `t0`.
2. **Response**: The server receives the message and immediately sends it back, adding its own local time as `t1`.
3. **Calculation**: The client receives the response at time `t2` and calculates the offset.

```typescript
// on the client, when receiving a clock sync response:
if (header.type === MessageType.Clocksync) {
  const sync = readClocksync(reader)
  const t2 = performance.now()
  
  // add sample to the world's internal manager
  addClockSample(world, sync.t0, sync.t1, t2)
  
  // update the timestep offset with the smoothed consensus
  const offset = getClockOffset(world)
  timestepSetOffset(timestep, offset)
}
```

### Lag Compensation

To keep prediction responsive, the client should run slightly ahead of the server. This ensures that your commands reach the server before it processes the tick they were intended for.

You can combine the estimated server time with your measured latency (RTT) and a small buffer to set your timestep's offset.

```typescript
// on receiving a clock sync response:
const serverOffset = getClockOffset(world)
const rtt = getClockRtt(world)

// calculate lead time: half-trip time + 2 tick buffer
const halfTrip = rtt / 2
const buffer = 2 * (1000 / 60)
const lagCompensation = halfTrip + buffer

// set the final offset: server time + lead time
timestepSetOffset(timestep, serverOffset + lagCompensation)
```

## 7. Handling Input

On the client, use `recordCommand` to store intent for the current tick.

```typescript
// inside the client loop
if (input.isDown("KeyW")) {
  recordCommand(world, playerEntity, MoveCommand({dx: 0, dy: -1}))
}

// send commands to server
const commandBuffer = getResource(world, CommandBuffer)
const commands = commandBuffer?.get(world.tick)
if (commands) {
  const bytes = serializeCommands(world.tick, commands)
  network.sendToServer(bytes)
}
```

## 8. Reconciliation

When the client receives a transaction from the server, it uses `receiveTransaction`. The `performRollback` system will then automatically detect if the server's state differs from what the client predicted. If it does, Glom will:

1.  **Roll back** the world state to the tick where the discrepancy occurred.
2.  **Re-simulate** every tick from that point up to the current predicted tick using the `reconcileSchedule` and the local command history.
3.  **Apply** the corrected state, ensuring the player's view remains accurate to the server's authority.

