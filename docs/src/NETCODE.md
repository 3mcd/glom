# Netcode

This guide covers how Glom handles networking and replication.

## Design Philosophy

Glom provides building blocks that you can combine for different networking needs.

Most of these tools are part of the ECS. Things like user inputs are components and systems. Some utilities, like the fixed timestep logic, are standalone because they are useful outside of the ECS.

## 1. Topologies

Glom is designed for both server-authoritative and P2P setups.

### Server-Authoritative
The server sends authoritative changes to the client. Clients send high-level commands to the server for validation.

### Distributed P2P
Each agent sends their local changes to all other peers. Conflicts are resolved using strategies like Last-Write-Wins.

## 2. Domains

Entities are represented as 32-bit integers. To prevent ID collisions without a central authority, Glom partitions the 32-bit space into Domains.

Each agent owns one domain. Only the owner can spawn or despawn entities in their domain. Remote entities are stored under their original domain, keeping IDs stable across the network.

### Example
Alice is in Domain 1, Bob is in Domain 2. Alice spawns an entity with ID `(1, 1)`. Bob spawns one with ID `(2, 1)`. When they sync, both worlds have both entities with no confusion.

## 3. Transactions and Replication

Replication uses Transactions. A transaction is a group of operations (spawn, despawn, set, remove) from a single domain.

Conflicts are handled with Last-Write-Wins. Each update has a version (usually the simulation tick). The world keeps track of the version for every component to ensure newer data isn't overwritten by older data.

## 4. Clock Synchronization

All clients attempt to run on the same global tick.

Glom uses an NTP-inspired handshake to calculate round-trip time and clock offset between agents. After gathering samples, it uses a median or average to update the local offset.

## 5. Prediction and Reconciliation

Glom supports predicted simulations with corrections.

### Snapshots
A snapshot for a tick represents the world state at the start of that tick. This allows the simulation to roll back, apply authoritative changes, and re-simulate to catch up.

### Optimistic Spawning
Clients can instantly spawn entities in their own domain. The server or other peers will receive these events later.

### Reconciliation Loop
When a client receives state that differs from its prediction, it rewinds to the tick of the discrepancy, applies the correction, and fast-forwards by re-simulating up to the current tick.

## 6. Predictive Shadowing

When simulation logic is identical on client and server, entities are often spawned by systems. In these cases, we let the server define the permanent ID.

### Transient Entities
When a client predicts a spawn it doesn't own, it uses a temporary ID in a reserved transient domain. It tags the entity with a key derived from the intent tick. When the server's version arrives with the same key, the client swaps the transient ID for the server's ID while keeping the component data.

## 7. Custom Protocol

Glom uses a binary protocol for messaging. This keeps messages small and fast to process.

## 8. Command API

Upstream communication (Client -> Server) uses a Command API. Intent is turned into discrete events. Commands are entities with components, allowing them to use the same replication logic as state.

## 9. Orchestration

Networking systems are integrated into your schedules. We provide groups for reconciliation, command management, and replication.

## 10. Selective Replication

You can control which entities are synced using the `Replicated` tag.
