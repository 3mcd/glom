# Entity Registry and Distributed Spawning

The `EntityRegistry` is responsible for managing the allocation and tracking of all entities in the system. In a distributed or multi-agent environment (P2P or server-authoritative), it ensures that entities can be created and destroyed deterministically across all nodes without ID collisions.

## Provenance-based Domains (Buckets)

The registry is organized into discrete domains, often referred to as "buckets." Each domain corresponds to a unique provenance value, represented by the `hi` bits of an `Entity`. In a fully-connected topology, every agent maintains a bucket for themselves and one for every other remote agent they are connected to. This segregated allocation ensures that when an agent with provenance `hi=5` creates an entity, it is allocated from domain 5. Even if another agent creates an entity at the exact same time, there is no risk of collision because their entities will have different `hi` bits.

## Predictive Spawning

One of the key features of the `EntityRegistry` is support for predictive spawning. Each agent acts as the owner of their own bucket, allowing them to spawn entities instantly in their local simulation without waiting for external acknowledgement. Because each agent has a dedicated ID space, remote agents can eventually receive these creation events and add the entity to their local representation of that agent's bucket, maintaining a consistent world state across the network.

## Determinism, Rollback, and Rebase

The registry is designed to support high-performance networking techniques like rollback and rebase through deterministic, atomic operations. Within a domain, the `entity_id` increments monotonically, which means resetting and re-running spawning logic will always produce the exact same sequence of IDs. Each domain also tracks a monotonic `op_seq` that increments with every local mutation, allowing remote agents to verify they have received all operations in the correct order.

Because an entity belongs to a specific domain for its entire lifecycle, rolling back one agent's simulation does not affect the ID allocation logic of others. This deterministic nature allows a local agent's predicted entity creations to be rebased onto the authoritative state without conflicts once they are confirmed by a server or peer.

## Conflict Avoidance

In a multi-agent system, conflicts usually arise from shared resources. The `EntityRegistry` avoids this by enforcing strict domain ownership where only the assigned agent allocates from a given domain. Every agent can see and track entities from all domains, but they only manage allocation for their own. The internal storage uses an efficient swap-and-pop strategy for removals, preserving the integrity of the remaining entities during high-frequency create/destroy cycles.

