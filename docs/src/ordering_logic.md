# Ordering Logic

Glom automatically manages the execution order of your systems. Instead of manually sorting systems in an array, you describe **what** data each system needs, and Glom handles the **when**.

## Data-Driven Ordering

The primary way to control system order is through `Read` and `Write` constraints in your system parameters. Glom uses these to build a Directed Acyclic Graph (DAG) and performs a topological sort to find a valid execution sequence.

### The Rule of Thumb: Write before Read

The most fundamental rule is **Producer-Consumer**: if System A writes to a component and System B reads from it, System A must run first.

```typescript
import { All, Read, Write } from "@glom/ecs";

// producer: always runs first because it writes Position
const physics_system = (query: All<Write<typeof Position>>) => {
  for (const [pos] of query) {
    pos.x += 1;
  }
};

// consumer: runs after physics because it reads Position
const rendering_system = (query: All<Read<typeof Position>>) => {
  for (const [pos] of query) {
    console.log(`Rendering at ${pos.x}`);
  }
};
```

### Multiple Writers

If multiple systems write to the same component, Glom orders them by their **registration order** (the order they were added to the `SystemSchedule`). This ensures that logic like "Input -> Physics -> Collision Response" stays predictable.

## Solving Cycles

A cycle occurs when your system dependencies form a loop. For example:
*   System A writes to `Component1` and reads `Component2`.
*   System B writes to `Component2` and reads `Component1`.

Glom will throw a `Cycle detected` error if this happens.

### How to Break a Cycle

Cycles usually indicate that your logic is trying to do too much in a single frame or that your data layout needs adjustment.

#### 1. Split the System
If a system is both a producer and a consumer of related data, consider splitting it into two smaller systems: one that updates the state and one that reacts to it.

#### 2. Use a "Request" Component
Instead of writing directly to a component that another system depends on, add a "Request" or "Command" component. System A adds the request, and System B processes all requests in the next frame (or later in the same frame).

#### 3. Use Tags for Multi-Phase Logic
If you have a complex sequence, use tags like `PhysicsPhase`, `AnimationPhase`, or `CleanupPhase` to explicitly group and order logic without coupling them to specific data types.

## Manual Overrides

While Glom's automatic ordering covers 99% of cases, you can influence the tie-breaking behavior (systems with no data overlap) simply by changing the order you call `add_system` in your schedule setup.

