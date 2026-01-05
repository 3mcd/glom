# Getting Started

Glom is an ECS for TypeScript with built-in networking capabilities.

For more information on how Glom handles synchronization and replication, see the [Netcode](NETCODE.html) documentation.

## 1. Setting up the Transformer (Optional)

While optional, the transformer is recommended as it allows you to write systems with a much cleaner syntax and optimizes query iteration by rewriting loops at build-time.

### For Bun
If you're using Bun, use the `glomBunPlugin`:

```typescript
import { glomBunPlugin } from "@glom/transformer-bun";

Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  plugins: [glomBunPlugin()],
});
```

### For Vite / Rollup
If you're using Vite or Rollup, you can use the `glomRollupPlugin`:

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import { glomRollupPlugin } from "@glom/transformer-rollup";

export default defineConfig({
  plugins: [glomRollupPlugin()],
});
```

## 2. Defining Components

Components are just data. Use `define_component` for data and `define_tag` for markers.

```typescript
import { define_component, define_tag } from "@glom/ecs";

export const Position = define_component<{ x: number; y: number }>();
export const Velocity = define_component<{ dx: number; dy: number }>();
export const IsPlayer = define_tag();
```

## 3. Setting up the World

The `World` holds everything. You initialize it with a schema of your components.

```typescript
import { make_world } from "@glom/ecs";

const schema = [Position, Velocity, IsPlayer];
const world = make_world(0, schema); // 0 is the domain ID
```

## 4. Writing Systems (with Transformer)

With the transformer enabled, you can write systems as functions. The types you use for parameters tell the transformer how to build the loops.

```typescript
import { All, Write, Read } from "@glom/ecs";

// Updates position based on velocity
export const movement_system = (
  query: All<Write<typeof Position>, Read<typeof Velocity>>
) => {
  for (const [pos, vel] of query) {
    pos.x += vel.dx;
    pos.y += vel.dy;
  }
};
```

## 5. Scheduling and Running

Add systems to a `SystemSchedule`. It sorts them based on component access (reads vs writes).

```typescript
import { make_system_schedule, add_system, run_schedule } from "@glom/ecs";

const schedule = make_system_schedule();
add_system(schedule, movement_system);

// In the loop
run_schedule(schedule, world);
```

## 6. Spawning Entities

Spawn an entity and add data to it.

```typescript
import { spawn, add_component, world_flush_graph_changes } from "@glom/ecs";

const player = spawn(world);
add_component(world, player, Position, { x: 0, y: 0 });
add_component(world, player, Velocity, { dx: 1, dy: 1 });
add_component(world, player, IsPlayer);

// Flush changes to make them available
world_flush_graph_changes(world);
```

---

## Appendix: Without the Transformer

If you don't want to use a build step, you can define systems manually using `define_system`. This requires you to explicitly describe the parameters so the scheduler knows how to order them, and the loops won't be as heavily optimized.

```typescript
import { All, Write, Read, define_system } from "@glom/ecs";

const movement_system = (query: All<Write<typeof Position>, Read<typeof Velocity>>) => {
  for (const [pos, vel] of query) {
    pos.x += vel.dx;
    pos.y += vel.dy;
  }
};

// Manually define the system metadata
define_system(movement_system, {
  params: [
    { all: [{ write: Position }, { read: Velocity }] }
  ]
});
```
