# Netcode

**Problem:** Real-time networked applications must maintain a consistent state across multiple participants despite varying latency and out-of-order data arrival.

## 1. Network Topologies

Glom is designed for both server-authoritative and P2P setups. In a server-authoritative topology, the server sends authoritative changes to the client, while clients send high-level commands to the server for validation. In a distributed P2P topology, each agent sends their local changes to all other peers, and conflicts are resolved using Last-Write-Wins.

## 2. Agent-Entity Domains

Entities are represented as 32-bit integers. Glom partitions the 32-bit space into domains to prevent ID collisions without a central authority.

Each agent owns one domain. Only the owner can spawn or despawn entities in their domain. Remote entities are stored under their original domain, keeping IDs stable across the network.

### Example
Alice is in Domain 1, Bob is in Domain 2. Alice spawns an entity with ID `(1, 1)`. Bob spawns one with ID `(2, 1)`. Both worlds have both entities with no confusion when they sync.

## 3. Transactions and Replication

Glom replicates state using **Transactions**. A transaction is an atomic bundle of operations—spawns, despawns, component additions, and removals—that occurred within a single domain during a specific tick.

By grouping changes into transactions, Glom ensures:

* **Atomicity**: All changes from a single tick are applied together. A client will never see a "partial" update where some components of an entity have been updated but others haven't.
* **Efficiency**: Multiple updates are packed into a single binary message, reducing network overhead and processing costs.
* **Version Integrity**: Every operation in a transaction is stamped with the same version (the world tick). This is used for **Last-Write-Wins** conflict resolution; the world tracks the version of every component on every entity to ensure that delayed or out-of-order packets never overwrite newer data.

## 4. Clock Synchronization

All clients attempt to run on the same global tick.

Glom uses an NTP-inspired handshake to calculate round-trip time and clock offset between agents. It uses a median or average to update the local offset after gathering samples.

## 5. Prediction and Reconciliation

Glom provides network utilities that enable predicted simulation with corrections. Snapshots for a tick represent the world state at the start of that tick, allowing the world to roll back, apply authoritative changes, and re-simulate to catch up. This enables optimistic spawning, where clients can instantly spawn entities in their own domain while the server or other peers receive these events later. If a client receives state that differs from its prediction, the reconciliation loop rewinds to the tick of the discrepancy, applies the correction, and fast-forwards by re-simulating up to the current tick.

## 6. Predictive Shadowing

When logic is identical on client and server, entities are often spawned by systems. We let the server define the permanent ID in these cases. Transient entities are used when a client predicts a spawn it doesn't own; it uses a temporary ID in a reserved transient domain and tags the entity with a key derived from the intent tick. The client swaps the transient ID for the server's ID when the server's version arrives with the same key while keeping the component data.

## 7. Custom Protocol

Glom uses a binary protocol for messaging. This keeps messages small and fast to process.

## 8. Command API

Upstream communication (Client -> Server) uses a Command API. Intent is turned into discrete events. Commands are entities with components, allowing them to use the same replication logic as state.

## 9. Orchestration

Networking systems are integrated into your schedules. We provide groups for reconciliation, command management, and replication.

## 10. Selective Replication

Users can control which entities are synced using the `Replicated` tag.

## 11. Networking API

### Identity and Time

#### `setDomainId(world, domainId)`
Sets the authoritative domain for the world's entity registry. This is typically called once when receiving the initial `Handshake` from a server to ensure that any entities spawned by this client use a unique ID range that won't collide with the server or other clients.

```typescript
// On the client, when receiving the initial handshake:
const handshake = readHandshake(reader)
setDomainId(world, handshake.domainId)
```

#### `setTick(world, tick)`
Manually sets the current world tick. This is used during the initial connection to sync the client's clock with the server, or when a massive clock drift is detected that cannot be corrected via smooth steering.

```typescript
// Sync the client tick to match the server after estimating latency:
const targetTick = handshake.tick + 6 // server tick + buffer
setTick(world, targetTick)
```

#### `addClockSample(world, t0, t1, t2)`
Adds an NTP-style sample to the internal clock sync manager. This is called whenever a `Clocksync` response is received from the server. Frequent sampling (e.g., every 1-5 seconds) allows Glom to maintain a smoothed estimate of network conditions.

```typescript
// On receiving a clocksync response from the server:
const t2 = performance.now()
addClockSample(world, sync.t0, sync.t1, t2)
```

#### `getClockOffset(world)`
Returns the smoothed time offset (in milliseconds) between the client and server. This is used to calculate the value passed to `timestepSetOffset`, representing the "real" time difference that needs to be accounted for to stay in sync with the server's clock.

```typescript
const offset = getClockOffset(world)
timestepSetOffset(timestep, offset)
```

#### `getClockRtt(world)`
Returns the average measured round-trip time (in milliseconds). Essential for **Lag Compensation**, this allows a client to run slightly ahead of the server, ensuring its commands reach the server before it processes that specific tick.

```typescript
const rtt = getClockRtt(world)
const halfTrip = rtt / 2
const buffer = 2 * (1000 / 60)
timestepSetOffset(timestep, getClockOffset(world) + halfTrip + buffer)
```

### Buffering

#### `receiveTransaction(world, transaction)`
Buffers an incoming transaction from a peer or server. This is called as soon as a transaction packet is decoded. The transaction is stored in the `IncomingTransactions` resource to be processed by the `performRollback` system at the start of the next frame.

```typescript
const type = readMessageType(reader)
const tick = reader.readUint32()
if (type === MessageType.Transaction) {
  const transaction = readTransaction(reader, tick, world)
  receiveTransaction(world, transaction)
}
```

#### `receiveSnapshot(world, snapshot)`
Buffers an authoritative world snapshot. This is used when receiving a full state update, which usually happens when a client first joins a game or after a significant synchronization failure.

```typescript
const type = readMessageType(reader)
const tick = reader.readUint32()
if (type === MessageType.Snapshot) {
  const snapshot = readSnapshot(reader, tick)
  receiveSnapshot(world, snapshot)
}
```

#### `recordCommand(world, target, command, [tick])`
Records a user intent command into the world's command buffer. This is called within input handling logic (e.g., every frame) to store commands in the `CommandBuffer` so they can be re-played during reconciliation if a rollback occurs.

```typescript
// Record a "Move" command for the local player entity
recordCommand(world, player, Move, { dx: 1.0, dy: 0.0 })
```

## 12. Networking Components

These components are typically added as **Resources** using `addResource`.

#### `Replicated`
A marker component used to identify entities that should be included in replication. This tag is added to any entity that should be visible to other peers; entities without this tag remain local to the world they were spawned in.

```typescript
// Tag an entity for replication
addComponent(world, player, Replicated)
```

#### `ReplicationConfig`
Configures high-level networking behavior, such as the `historyWindow` (how many ticks of history to keep for rollbacks) and the `reconcileSchedule` (the systems used during re-simulation).

```typescript
addResource(world, ReplicationConfig, {
  historyWindow: 120,
  reconcileSchedule: myReconcileSchedule
})
```

#### `ReplicationStream`
The outgoing buffer for networking data. The network transport layer reads from this component at the end of every frame to find new `transactions` and `snapshots` that need to be broadcast to other participants.

```typescript
// In your transport layer at the end of the tick:
const stream = getResource(world, ReplicationStream)
for (const transaction of stream.transactions) {
  sendToPeers(transaction)
}
```

#### `IncomingTransactions`
A buffer for receiving peer updates that haven't been applied to the world yet. This resource is typically populated by the transport layer using `receiveTransaction` and then drained by `performRollback` or `applyRemoteTransactions`.

```typescript
// Initialize the incoming transaction buffer
addResource(world, IncomingTransactions)
```

#### `IncomingSnapshots`
A buffer for periodic authoritative state updates. Similar to transactions, this resource is populated by the transport layer and used by the reconciliation system to perform hard resets of the world state when necessary.

```typescript
// Initialize the incoming snapshot buffer
addResource(world, IncomingSnapshots)
```

## 13. Built-in Networking Systems

### Reconciliation Systems (Client-side)

#### `performRollback`
The core engine of client-side prediction. This system is typically scheduled at the very beginning of the client's `Main` schedule. It checks the `IncomingTransactions` buffer against the `HistoryBuffer` and automatically rewinds the world and re-simulates missing frames if a discrepancy is found. It also re-applies local commands from the `CommandBuffer` during re-simulation.

#### `cleanupGhosts`
Prunes unconfirmed predicted entities. This system belongs in the client schedule and deletes transient entities created during prediction if they haven't been "confirmed" (rebound to a server ID) in the `HistoryBuffer` within a certain time window.

#### `applyRemoteTransactions`
Applies buffered peer updates for the current tick. This is typically used in P2P setups or simple non-predictive clients to apply changes from the `IncomingTransactions` buffer as they arrive.

### Replication Systems (Server/Host-side)

#### `commitPendingMutations`
Captures all changes made in the current tick. This system is typically scheduled at the end of the server's simulation logic to flatten all `spawn`, `despawn`, and `addComponent` calls into optimized transactions stored in the `ReplicationStream`.

#### `emitSnapshots`
Captures the full state of all replicated entities. This system is usually run at a lower frequency than the main simulation logic (e.g., every 60 ticks) to provide a "ground truth" for new or lagging clients. It generates full world snapshots in the `ReplicationStream` based on the configuration in `ReplicationConfig`.

#### `clearReplicationStream`
Resets outgoing buffers. This system is typically scheduled at the very beginning of the server schedule to ensure that the `ReplicationStream` is cleared and data from the previous frame is not re-sent.

#### `advanceWorldTick`
Increments the tick counter and saves history. This system is typically scheduled at the very end of the schedule to mark the completion of a tick and push a snapshot of the world into the `HistoryBuffer` for future reconciliation.

### Utility Systems

#### `spawnEphemeralCommands`
Turns recorded inputs into queryable entities. This system is typically scheduled before the main simulation logic to look at the `CommandBuffer` for the current tick and spawn temporary entities so systems can use standard queries to read player intent.

#### `cleanupEphemeralCommands`
Removes temporary command entities. This system is typically scheduled after the simulation logic to keep the world clean and ensure command entities created from the `CommandBuffer` do not persist into the next tick.
