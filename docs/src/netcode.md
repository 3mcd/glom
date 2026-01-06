# Netcode

**Problem:** Real-time networked applications must maintain a consistent state across multiple participants despite varying latency and out-of-order data arrival.

## 1. Topologies

Glom is designed for both server-authoritative and P2P setups. The server sends authoritative changes to the client in a server-authoritative topology, while clients send high-level commands to the server for validation. Each agent sends their local changes to all other peers in a distributed P2P topology, and conflicts are resolved using strategies like Last-Write-Wins.

## 2. Domains

Entities are represented as 32-bit integers. Glom partitions the 32-bit space into Domains to prevent ID collisions without a central authority.

Each agent owns one domain. Only the owner can spawn or despawn entities in their domain. Remote entities are stored under their original domain, keeping IDs stable across the network.

### Example
Alice is in Domain 1, Bob is in Domain 2. Alice spawns an entity with ID `(1, 1)`. Bob spawns one with ID `(2, 1)`. Both worlds have both entities with no confusion when they sync.

## 3. Transactions and Replication

Replication uses transactions. A transaction is a group of operations (spawn, despawn, set, remove) from a single domain.

Conflicts are handled with Last-Write-Wins. Each update has a version (usually the world tick). The world keeps track of the version for every component to ensure newer data isn't overwritten by older data.

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
