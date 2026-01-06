# Component Storage

**Problem:** Storing state within heterogeneous entity objects prevents JavaScript engines from specializing functions and causes frequent "hidden class" transitions during simulation.

## Entity Indexing

The `World` does not use raw entity IDs to index arrays to support networking and multiple agents. Instead, it uses a local mapping.

### How it works

Entity IDs are 31-bit integers that are unique across the network. The `World` assigns a local index when it sees an entity. A `SparseMap` called `entityToIndex` stores this mapping. This prevents collisions when different agents create entities.

```text
World
├── entityToIndex
│   ├── [Entity: 1] ──> Index: 0
│   └── [Entity: 2] ──> Index: 1
└── storage
    ├── [Component A] ── [Value, Value, ...]
    └── [Component B] ── [Value, Value, ...]
```

## Characteristics of this Model

### Memory and Optimization

Storing data in homogenous arrays allows the engine to specialize loops and avoid the overhead of looking up properties on varying object shapes. The layout of components should be stable, which helps engines optimize access via hidden classes and code generation.

### Iteration

Systems get references to component stores once and use direct indexed lookups in their loops.

```typescript
// Conceptual optimized loop
const posStore = world.components.storage[Position.id]
const velStore = world.components.storage[Velocity.id]
const mapping = world.index.entityToIndex.sparse

for (const id of entities) {
  const idx = mapping[id]
  const pos = posStore[idx]
  const vel = velStore[idx]
  pos.x += vel.x
}
```

### Archetype Migration

Data for an entity stays in the same place in storage when its archetype changes (like adding a component). Only the pointers in the `EntityGraph` are updated.

### Direct Indexing

Using a local index keeps array indices low and contiguous. This allows engines to use optimized array types for better performance.

## Accessing Data

- `getComponentValue(world, entity, component)`: Look up a value.
- `setComponentValue(world, entity, component, value)`: Assign a value.
- `getComponentStore(world, component)`: Get the underlying array for a component.
