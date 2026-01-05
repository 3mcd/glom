# Ordering Logic

Glom manages the execution order of systems. You describe what data each system needs, and the scheduler determines when to run it.

## Data-Driven Ordering

Systems are ordered based on `Read` and `Write` constraints. Glom builds a graph of these dependencies and sorts them to find a valid order.

### Rule: Write before Read

If System A writes to a component and System B reads from it, System A runs first.

```typescript
import { All, Read, Write } from "@glom/ecs";

// physics writes Position
const physics_system = (query: All<Write<typeof Position>>) => {
  for (const [pos] of query) {
    pos.x += 1;
  }
};

// rendering reads Position
const rendering_system = (query: All<Read<typeof Position>>) => {
  for (const [pos] of query) {
    // runs after physics
  }
};
```

### Multiple Writers

If multiple systems write to the same component, they run in the order they were added to the schedule. This keeps logic like physics and collision predictable.

## Cycles

A cycle happens when system dependencies loop (e.g., A needs B, and B needs A). Glom will report an error if this happens.

### Breaking a Cycle

Cycles usually mean a system is doing too much or the data layout could be changed.

1.  **Split the System**: If a system both updates and reacts to data, split it into two.
2.  **Use a Request**: Instead of writing directly, add a component that another system processes later.
3.  **Use Tags**: You can use tags like `PhysicsPhase` or `AnimationPhase` to group and order logic without linking them to specific data.

## Manual Overrides

For systems with no data overlap, you can control the order by changing the order of `add_system` calls.
