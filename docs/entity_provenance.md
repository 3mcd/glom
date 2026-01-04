# Entity Composition and Provenance

In Glom ECS, an `Entity` is represented as a single 31-bit integer. This integer is composed of two distinct parts: the **Local ID (lo bits)** and the **Domain ID (hi bits)**.

## Bit Distribution

The 31 bits are distributed as follows:

-   **LO (Bits 0-19)**: 20 bits are reserved for the local entity ID.
-   **HI (Bits 20-30)**: 11 bits are reserved for the domain ID (provenance) of the entity.

```text
 30          20 19           0
+--------------+--------------+
|      HI      |      LO      |
|  (Domain ID) |  (Local ID)  |
+--------------+--------------+
```

## LO: Local ID

The `lo` bits represent a unique identifier within a specific domain.
-   **Unique & Auto-incrementing**: New entities are assigned an ID that increments within their domain.
-   **Recycled**: When an entity is destroyed, its ID is eventually recycled to keep the sparse set dense and memory usage efficient.
-   **Capacity**: With 20 bits, each domain can support up to \(2^{20} = 1,048,576\) concurrent entities.

## HI: Domain ID (Provenance)

The `hi` bits trace the **origin** of the entity in a multi-agent or distributed system.
-   **Agent Identification**: In a system where multiple agents or servers create entities, the `domain_id` value identifies which agent created the entity.
-   **Conflict Avoidance**: By segregating IDs by domain, different agents can create entities simultaneously without requiring central synchronization or risking ID collisions.
-   **Tracing**: The domain ID allows the system to determine where an entity "belongs" or where its authoritative state resides.
-   **Capacity**: With 11 bits, the system supports up to \(2^{11} = 2,048\) unique domains.

## Why 31 Bits?

The choice of a 31-bit representation is an optimization for JavaScript runtimes (like V8 in Node.js and Bun).

-   **Small Integers (SMIs)**: In these runtimes, integers that fit within 31 bits are often represented as "Small Integers" (SMIs).
-   **No Heap Allocation**: SMIs are stored directly within the pointer itself using a tagging scheme. This means they do not require heap allocation and avoid the overhead of garbage collection.
-   **Performance**: Operating on SMIs is significantly faster than operating on "Heap Numbers" (double-precision floats), as they can be handled as immediate values in CPU registers.
-   **Memory Efficiency**: By keeping the `Entity` representation within the SMI range, the ECS can maintain large arrays of entities with minimal memory pressure and maximum cache locality.

## Utility Functions

The `src/entity.ts` module provides helpers to work with these parts:

-   `get_local_id(entity)`: Extracts the 20-bit ID.
-   `get_domain_id(entity)`: Extracts the 11-bit provenance.
-   `make_entity(local_id, domain_id)`: Composes a new Entity from a local ID and a domain ID.

