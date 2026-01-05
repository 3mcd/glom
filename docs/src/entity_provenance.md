# Entity Composition and Provenance

**Problem:** Entities need to be uniquely identifiable across a network without the overhead of central coordination or large, heap-allocated identifiers.

An `Entity` is a single 31-bit integer in Glom. It is composed of two parts: the local ID (lo bits) and the domain ID (hi bits).

## Bit Distribution

The 31 bits are split into two regions. Bits 0-19 are for the local entity ID, providing a high capacity for entities within a single domain. Bits 20-30 are for the domain ID, which identifies the entity's origin.

```text
 30          20 19           0
+--------------+--------------+
|      HI      |      LO      |
|  (Domain ID) |  (Local ID)  |
+--------------+--------------+
```

## LO: Local ID

The `lo` bits are a unique identifier within a domain. New entities are assigned an auto-incrementing ID, ensuring that every newly spawned entity starts with a unique label. The ID of a destroyed entity is recycled and eventually reused to maintain a compact address space. This system provides a capacity of up to 1,048,576 concurrent entities per domain.

## HI: Domain ID (Provenance)

The `hi` bits identify the origin of the entity. The `domain_id` allows you to track which agent created which entity in multi-agent systems. This ensures conflict avoidance, as different agents can create entities at the same time without their IDs colliding. This addressing scheme supports a capacity of up to 2,048 unique domains.

## Why 31 Bits?

The choice of 31 bits is an optimization for JavaScript runtimes like V8. Integers that fit within 31 bits are often represented as small integers (SMIs). SMIs require no heap allocation because they are stored directly within the pointer, avoiding the overhead of garbage collection. This provides performance benefits, as operating on SMIs is faster than operating on heap-allocated numbers.
