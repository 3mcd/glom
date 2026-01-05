# Getting Started

This guide explains how to set up Glom and the reasoning behind its core patterns.

## 1. Setting up the Transformer (Optional)

Glom includes a build-time transformer. It is used to inline query loops and determine system dependencies before your code runs.

The transformer rewrites standard JavaScript generators into fast while loops and infers system dependencies based on parameter types.

### For Bun
If you're using Bun, use the `glomBunPlugin`:

```typescript
import { glomBunPlugin } from "@glom/transformer-bun"

Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  plugins: [glomBunPlugin()],
})
```

### For Vite / Rollup
If you're using Vite or Rollup, you can use the `glomRollupPlugin`:

```typescript
// vite.config.ts
import { defineConfig } from "vite"
import { glomRollupPlugin } from "@glom/transformer-rollup"

default defineConfig({
  plugins: [glomRollupPlugin()],
})
```

## 2. Defining Components

Components represent your game's state. In Glom, they're the JavaScript values you're already used to. Because they're just plain data types, they work naturally with other libraries without the need for wrappers or extra data copying.

Each entity can have only one instance of a specific component type at a time. For example, an entity can't have two `Position` components. Technically, relationships do provide the means to give an entity multiple instances of a component, but we'll keep it simple in this guide.

`define_component` creates a component that represents a value.

```typescript
import { define_component, define_tag } from "@glom/ecs"

const Position = define_component<{ x: number; y: number }>()
const Velocity = define_component<{ dx: number; dy: number }>()
```

While `define_tag` creates a marker that doesn't hold any data.

```typescript
const IsPlayer = define_tag()
```

## 3. Setting up the World

The `World` is the container for all the entities and components in a simulation. When you create one, you'll need to provide a **domain ID** and a **schema**.

The **domain ID** is an integer that helps Glom manage entity creation in networked environments. By giving each peer their own ID, everyone can spawn entities at the same time without their IDs colliding. If you're building a single-player game, you can just set this to `0`.

The **schema** is a list of the components you plan to use. Glom needs this to pre-allocate storage for those components and to ensure they're identified the same way across different worlds.

```typescript
import { make_world } from "@glom/ecs"

const schema = [Position, Velocity, IsPlayer]
const world = make_world(0, schema) // 0 is the domain ID
```

## 4. Writing Systems (with Transformer)

Systems are where you implement your logic.

Systems are functions that receive component queries as parameters. Declaring dependencies like `Read<Position>` allows the scheduler to determine execution order and optimize storage access.

```typescript
import { All, Write, Read } from "@glom/ecs"

// Updates position based on velocity
const movement_system = (
  query: All<Write<typeof Position>, Read<typeof Velocity>>
) => {
  for (const [pos, vel] of query) {
    pos.x += vel.dx
    pos.y += vel.dy
  }
}
```

## 5. Scheduling and Running

Systems are organized into a `SystemSchedule`.

The schedule uses the read and write requirements of each system to determine their execution order. Systems that write to a component are sorted to run before systems that read from the same component.

```typescript
import { make_system_schedule, add_system, run_schedule } from "@glom/ecs"

const schedule = make_system_schedule()
add_system(schedule, movement_system)

// In your main loop
run_schedule(schedule, world)
```

## 6. Spawning Entities

Entities are discrete units, identified by a unique integer.

Entities are integer IDs that associate components. `world_flush_graph_changes` batches component additions and removals into a single pass to update the internal entity graph.

```typescript
import { spawn, add_component, world_flush_graph_changes } from "@glom/ecs"

const player = spawn(world)
add_component(world, player, Position, { x: 0, y: 0 })
add_component(world, player, Velocity, { dx: 1, dy: 1 })
add_component(world, player, IsPlayer)

// Flush changes so they're available to queries
world_flush_graph_changes(world)
```

## Appendix: Without the Transformer

If you don't want to use a build step, you can define systems manually.

Some workflows might not support a build-time transformer. `define_system` lets you provide the same metadata explicitly in your code.

```typescript
import { All, Write, Read, define_system } from "@glom/ecs"

const movement_system = (query: All<Write<typeof Position>, Read<typeof Velocity>>) => {
  for (const [pos, vel] of query) {
    pos.x += vel.dx
    pos.y += vel.dy
  }
}

// Manually define the system metadata
define_system(movement_system, {
  params: [
    { all: [{ write: Position }, { read: Velocity }] }
  ]
})
```
