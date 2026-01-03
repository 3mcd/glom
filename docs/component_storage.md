# Component Storage Architecture

Glom ECS uses a **Universal Component Storage (SOA)** model. Instead of storing component values inside objects tied to each entity (AOS), all values for a specific component type are stored in a single, large array at the `World` level.

## Entity Indexing and Replication

To support multi-agent systems and replication without ID collisions, the `World` does not use the raw 31-bit `Entity` ID (or its `lo` bits) to directly index component arrays. Instead, it uses a **Dense Local Mapping**.

### How it works:
1.  **Stable Entity ID**: The 31-bit integer remains the unique, global identifier for an entity across the network.
2.  **Local Dense Index**: When the `World` first encounters an entity (local spawn or remote replication), it assigns it a local, monotonically increasing index.
3.  **Mapping**: A `SparseMap` (`entity_to_index`) stores the relationship between the global ID and the local index.

This allows two different agents to create entities with the same `lo` bits (but different `hi` bits) and have them coexist in the same world without their component values overwriting each other.

```text
World
├── entity_to_index (SparseMap)
│   ├── [Entity: hi=1, lo=100] ──> Index: 0
│   └── [Entity: hi=2, lo=100] ──> Index: 1
└── storage (Array)
    ├── [ComponentID: 10] ── [Value(A), Value(B), ...] (Array)
    └── [ComponentID: 11] ── [Value(A), Value(B), ...] (Array)
```

## Advantages of this Model

### 1. Memory and GC Efficiency
By using a few large arrays instead of millions of small component objects, we significantly reduce the overhead of the JavaScript engine's garbage collector.
-   **Stable Shapes**: The "shape" of the component stores is stable, allowing engines like V8 to optimize access.
-   **Reduced Object Overhead**: We avoid the 40-80 byte overhead associated with creating a new object for every entity-component pair.

### 2. High-Performance Iteration
When a system runs, it can grab references to the relevant component stores once and then perform direct indexed lookups within its inner loop.

```typescript
// Conceptual optimized system loop
const pos_store = world.components.storage[Position.id];
const vel_store = world.components.storage[Velocity.id];
const mapping = world.index.entity_to_index.sparse;

for (const id of entities) {
  const idx = mapping[id]; // Direct lookup of local index
  const pos = pos_store[idx];
  const vel = vel_store[idx];
  pos.x += vel.x;
}
```

### 3. Zero-Copy Archetype Migration
When an entity's archetype changes (e.g., adding a component), its data stays exactly where it is in the universal storage. Only the `EntityGraph` pointers are updated. This is crucial for **Continuous Predicted Simulation**, where entities frequently change state due to local prediction or server corrections.

### 4. Direct Indexing (SMI Optimization)
By using a local dense index, we keep the array indices contiguous and low. Modern JS engines can treat these arrays as densely packed "Fast Arrays" indexed by SMIs (Small Integers), which is the most performant way to access data in JavaScript.

## Accessing Data

-   `get_component_value(world, entity, component)`: O(1) lookup of a value.
-   `set_component_value(world, entity, component, value)`: O(1) assignment.
-   `get_component_store(world, component)`: Returns the underlying array for a component, ideal for bulk processing or transformer-based inlining.

