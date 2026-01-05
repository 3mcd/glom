# Getting Started

Glom is an ECS for TypeScript with networking.

For more information on how Glom handles synchronization and replication, see the [Netcode](NETCODE.html) guide.

## 1. Setting up the Transformer (Optional)

The transformer is a build-time tool that rewrites query loops. It isn't required, but it makes systems easier to write and faster to run.

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

Components are data structures. Use `define_component` for data and `define_tag` for markers.

```typescript
import { define_component, define_tag } from "@glom/ecs";

export const Position = define_component<{ x: number; y: number }>();
export const Velocity = define_component<{ dx: number; dy: number }>();
export const IsPlayer = define_tag();
```

## 3. Setting up the World

The `World` is the container for entities and components. You initialize it with a list of your components.

```typescript
import { make_world } from "@glom/ecs";

const schema = [Position, Velocity, IsPlayer];
const world = make_world(0, schema); // 0 is the domain ID
```

## 4. Writing Systems (with Transformer)

When using the transformer, systems are functions. The parameter types tell the transformer which components to query.

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

Systems are added to a `SystemSchedule`. The schedule sorts them based on whether they read or write to components.

```typescript
import { make_system_schedule, add_system, run_schedule } from "@glom/ecs";

const schedule = make_system_schedule();
add_system(schedule, movement_system);

// In the main loop
run_schedule(schedule, world);
```

## 6. Spawning Entities

Entities are created with `spawn`. You can add components to them during or after spawning.

```typescript
import { spawn, add_component, world_flush_graph_changes } from "@glom/ecs";

const player = spawn(world);
add_component(world, player, Position, { x: 0, y: 0 });
add_component(world, player, Velocity, { dx: 1, dy: 1 });
add_component(world, player, IsPlayer);

// Flush changes to make them available to queries
world_flush_graph_changes(world);
```

## Appendix: Without the Transformer

If you don't use the build step, you define systems manually with `define_system`. You have to explicitly describe the parameters so the scheduler can order them.

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
