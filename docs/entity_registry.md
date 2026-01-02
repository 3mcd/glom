# Entity Registry and Distributed Spawning

The `EntityRegistry` is responsible for managing the allocation and tracking of all entities in the system. In a distributed or multi-agent environment (P2P or server-authoritative), it ensures that entities can be created and destroyed deterministically across all nodes without ID collisions.

## Provenance-based Domains (Buckets)

The registry is organized into discrete **domains** (often referred to as "buckets"). Each domain corresponds to a unique provenance value, represented by the `hi` bits of an `Entity`.

-   **Agent Buckets**: In a fully-connected topology, every agent maintains a bucket for themselves and one for every other remote agent they are connected to.
-   **Segregated Allocation**: When an agent with provenance `hi=5` creates an entity, it is allocated from domain `5`. This ensures that even if agent `10` creates an entity at the exact same time, there is no risk of collision because their entities will have different `hi` bits.

## Predictive Spawning

One of the key features of the `EntityRegistry` is support for **Predictive Spawning**.

-   **Local Authority**: Each agent is the "owner" of their own bucket. They can spawn entities instantly in their local simulation without waiting for a server or other peers to acknowledge the creation.
-   **Distributed Consistency**: Because each agent has a dedicated ID space, remote agents can eventually receive the creation event and add the entity to their local representation of that agent's bucket, maintaining a consistent world state across the network.

## Determinism, Rollback, and Rebase

The registry is designed to support high-performance networking techniques like rollback and rebase.

-   **Atomic Operations**: Adding or removing entities from a domain is an atomic and deterministic operation.
-   **Deterministic IDs**: Within a domain, the `entity_id` increments monotonically. This means if you reset the simulation to a previous state and re-run the same spawning logic, you will get the exact same sequence of entity IDs.
-   **Stateless Migration**: Because an entity "belongs" to a specific domain for its entire lifecycle, rolling back the simulation of one agent does not affect the ID allocation logic of any other agent.
-   **Conflict-Free Rebasing**: When a local agent's "predicted" entity creation is eventually confirmed by a server or peer, the deterministic nature of the IDs allows the local state to be rebased onto the authoritative state without conflicts.

## Conflict Avoidance

In a multi-agent system, conflicts usually arise from shared resources. The `EntityRegistry` avoids this by:
1.  **Strict Domain Ownership**: Only the agent assigned to a `hi` value allocates from that domain.
2.  **Shared Visibility**: Every agent can *see* and *track* entities from all domains, but they only *manage allocation* for their own.
3.  **Atomic Swap-and-Pop**: The internal storage (`dense` and `sparse` sets) uses a swap-and-pop strategy for removals, which is efficient and preserves the integrity of the remaining entities during high-frequency create/destroy cycles.

