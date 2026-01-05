# Component Storage

Glom uses a universal storage model. Instead of storing component values inside entity objects, all values for a component type are stored in one array in the `World`.

## Entity Indexing

To support networking and multiple agents, the `World` does not use raw entity IDs to index arrays. Instead, it uses a local mapping.

### How it works

Entity IDs are 31-bit integers that are unique across the network. When a `World` sees an entity, it assigns it a local index. A `SparseMap` called `entity_to_index` stores this mapping. This prevents collisions when different agents create entities.

```text
World
├── entity_to_index
│   ├── [Entity: 1] ──> Index: 0
│   └── [Entity: 2] ──> Index: 1
└── storage
    ├── [Component A] ── [Value, Value, ...]
    └── [Component B] ── [Value, Value, ...]
```

## Characteristics of this Model

### Memory and GC

By using arrays instead of many small objects, there is less work for the JavaScript garbage collector. The layout of the component stores is stable, which helps engines optimize access.

### Iteration

Systems get references to component stores once and use direct indexed lookups in their loops.

```typescript
// Conceptual optimized loop
const pos_store = world.components.storage[Position.id]
const vel_store = world.components.storage[Velocity.id]
const mapping = world.index.entity_to_index.sparse

for (const id of entities) {
  const idx = mapping[id]
  const pos = pos_store[idx]
  const vel = vel_store[idx]
  pos.x += vel.x
}
```

### Archetype Migration

When an entity's archetype changes (like adding a component), its data stays in the same place in storage. Only the pointers in the `EntityGraph` are updated.

### Direct Indexing

Using a local index keeps array indices low and contiguous. This allows engines to use optimized array types for better performance.

## Accessing Data

- `get_component_value(world, entity, component)`: Look up a value.
- `set_component_value(world, entity, component, value)`: Assign a value.
- `get_component_store(world, component)`: Get the underlying array for a component.
