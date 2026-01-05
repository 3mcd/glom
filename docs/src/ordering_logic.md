# Ordering Logic

Glom manages the execution order of systems. You describe what data each system needs, and the scheduler determines when to run it.

## Data-Driven Ordering

Systems are ordered based on `Read` and `Write` constraints. Glom builds a graph of these dependencies and sorts them to find a valid order.

### Rule: Write before Read

If System A writes to a component and System B reads from it, System A runs first.

```typescript
import { All, Read, Write } from "@glom/ecs"

// physics writes Position
const physics_system = (query: All<Write<typeof Position>>) => {
  for (const [pos] of query) {
    pos.x += 1
  }
}

// rendering reads Position
const rendering_system = (query: All<Read<typeof Position>>) => {
  for (const [pos] of query) {
    // runs after physics
  }
}
```

### Multiple Writers

If multiple systems write to the same component, they run in the order they were added to the schedule. This keeps logic like physics and collision predictable between worlds.

## Cycles

A cycle happens when system dependencies loop (e.g., A needs B, and B needs A). Glom will report an error if this happens.

### Breaking a Cycle

A cycle usually indicates that your systems are too tightly coupled. If you run into one, here are a few ways to resolve it:

1. **Logical Schedules**: Move one of the systems to a different schedule (e.g., from `Main` to `PostUpdate`) to enforce a clear execution boundary.
2. **Component Refactoring**: Split a large component into smaller ones. Cycles often occur when a single component is overloaded with multiple responsibilities.
3. **Event-Driven Decoupling**: Use short-lived "command" entities to pass data between systems across frames, effectively breaking the direct dependency.

## Manual Overrides

For systems with no data overlap, you can control the order by changing the order of `add_system` calls.
