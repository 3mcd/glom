# Entity Composition and Provenance

In Glom, an `Entity` is a single 31-bit integer. It is composed of two parts: the **Local ID (lo bits)** and the **Domain ID (hi bits)**.

## Bit Distribution

The 31 bits are split into two regions. **LO (Bits 0-19)** uses 20 bits for the local entity ID, providing a high capacity for entities within a single domain. **HI (Bits 20-30)** uses the remaining 11 bits for the domain ID, which identifies the entity's origin.

```text
 30          20 19           0
+--------------+--------------+
|      HI      |      LO      |
|  (Domain ID) |  (Local ID)  |
+--------------+--------------+
```

## LO: Local ID

The `lo` bits are a unique identifier within a domain. New entities are assigned an **Auto-incrementing** ID, ensuring that every newly spawned entity starts with a unique label. When an entity is destroyed, its ID is **Recycled** and eventually reused to maintain a compact address space. This system provides a **Capacity** of up to 1,048,576 concurrent entities per domain.

## HI: Domain ID (Provenance)

The `hi` bits identify the origin of the entity. In multi-agent systems, the **Agent Identification** provided by the `domain_id` allows you to track which agent created which entity. This ensures **Conflict Avoidance**, as different agents can create entities at the same time without their IDs colliding. This addressing scheme supports a **Capacity** of up to 2,048 unique domains.

## Why 31 Bits?

The choice of 31 bits is an optimization for JavaScript runtimes like V8. Integers that fit within 31 bits are often represented as **Small Integers (SMIs)**. Because SMIs are stored directly within the pointer, they require **No Heap Allocation**, avoiding the overhead of garbage collection. This provides significant **Performance** benefits, as operating on SMIs is faster than operating on heap-allocated numbers.
