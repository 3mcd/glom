# Ordering Logic

Glom manages the execution order of systems. You describe what data each system needs, and the scheduler determines when to run it.

## Data-Driven Ordering

Systems are ordered based on `Read` and `Write` constraints. Glom builds a graph of these dependencies and sorts them to find a valid order.

### Rule: Write before Read

System A runs first if System A writes to a component and System B reads from it.

```typescript
import { All, Read, Write } from "@glom/ecs"

// physics writes Position
const physicsSystem = (query: All<Write<typeof Position>>) => {
  for (const [pos] of query) {
    pos.x += 1
  }
}

// rendering reads Position
const renderingSystem = (query: All<Read<typeof Position>>) => {
  for (const [pos] of query) {
    // runs after physics
  }
}
```

### Multiple Writers

Multiple systems run in the order they were added to the schedule if they write to the same component. This keeps logic like physics and collision predictable between worlds.

## Cycles

A cycle happens when system dependencies loop (e.g., A needs B, and B needs A). Glom will report an error if this happens.

### Breaking a Cycle

A cycle usually indicates that your systems are too tightly coupled. Here are a few ways to resolve a cycle if you run into one:

1. Move one of the systems to a different schedule (e.g., from `Main` to `PostUpdate`) to enforce a clear execution boundary.
2. Split a large component into smaller ones. Cycles often occur when a single component is overloaded with multiple responsibilities.
3. Use short-lived "command" entities to pass data between systems across frames, effectively breaking the direct dependency.

## Manual Overrides

You can control the order by changing the order of `addSystem` calls for systems with no data overlap.
