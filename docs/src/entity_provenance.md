# Entity Composition and Provenance

In Glom, an `Entity` is a single 31-bit integer. It is composed of two parts: the **Local ID (lo bits)** and the **Domain ID (hi bits)**.

## Bit Distribution

- **LO (Bits 0-19)**: 20 bits for the local entity ID.
- **HI (Bits 20-30)**: 11 bits for the domain ID.

```text
 30          20 19           0
+--------------+--------------+
|      HI      |      LO      |
|  (Domain ID) |  (Local ID)  |
+--------------+--------------+
```

## LO: Local ID

The `lo` bits are a unique identifier within a domain.

- **Auto-incrementing**: New entities are assigned an incrementing ID.
- **Recycled**: When an entity is destroyed, its ID is eventually reused.
- **Capacity**: Supports up to 1,048,576 concurrent entities per domain.

## HI: Domain ID (Provenance)

The `hi` bits identify the origin of the entity.

- **Agent Identification**: In multi-agent systems, the `domain_id` identifies which agent created the entity.
- **Conflict Avoidance**: Different agents can create entities at the same time without ID collisions.
- **Capacity**: Supports up to 2,048 unique domains.

## Why 31 Bits?

The choice of 31 bits is an optimization for JavaScript runtimes like V8.

- **Small Integers (SMIs)**: Integers that fit within 31 bits are often represented as SMIs.
- **No Heap Allocation**: SMIs are stored directly within the pointer, avoiding heap allocation and garbage collection overhead.
- **Performance**: Operating on SMIs is faster than operating on heap-allocated numbers.
