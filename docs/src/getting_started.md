# Getting Started

This guide explains how to set up Glom and the reasoning behind its core patterns.

## Installation

First, install the core ECS package:

```bash
bun add @glom/ecs
```

If you plan on using the build-time transformer, you'll also need the corresponding plugin for your bundler:

```bash
# if using Bun
bun add -d @glom/transformer-bun

# if using Vite / Rollup
bun add -d @glom/transformer-rollup
```

## 1. Setting up the Transformer (Optional)

Glom includes a build-time transformer. It is used to inline query loops and determine system dependencies before your code runs.

The transformer rewrites standard JavaScript generators into fast while loops and infers system dependencies based on parameter types.

### For Bun

To use the transformer with Bun, register the `glomBunPlugin` in your build configuration.

```typescript
import { glomBunPlugin } from "@glom/transformer-bun"

Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  plugins: [glomBunPlugin()],
})
```

### For Vite / Rollup

To use the transformer with Vite or Rollup, add the `glomRollupPlugin` to your plugins list.

```typescript
// vite.config.ts
import { defineConfig } from "vite"
import { glomRollupPlugin } from "@glom/transformer-rollup"

default defineConfig({
  plugins: [glomRollupPlugin()],
})
```

## 2. ECS 101

This section briefly describes the building blocks of an Entity-Component System.

**Entities** are simple integer IDs that serve as labels to group data together. They don't contain any logic or data themselves; instead, they act as stable reference points for various **Components**. These components are plain data objects that represent a specific aspect of an entity, such as its position, health, or a player tag.

The logic of your application is contained within **Systems**, which are functions that operate on entities matching specific component criteria. For example, a movement system might update the position of every entity that has both a position and a velocity component. All of these entities and components are managed by the **World**, the central container that your systems run logic against.

When a system runs, its queries resolve which nodes in the [Entity Graph](./entity_graph.md) match the required components:

<img src="query-graph.png" style="max-width: 444px;">

The query then identifies the entities stored at those nodes and fetches their component data for processing.

<img src="query-storage.png" style="max-width: 218px;">

## 3. Defining Components

Components represent your game's state. In Glom, component instances can be any JavaScript data type. Because they're just plain values, they work naturally with other libraries without the need for wrappers or extra data copying.

Each entity can have only one instance of a specific component type at a time. For example, an entity can't have two `Position` components.

<aside>
You can achieve something close to entities with multiple components with [relationships](./relationships).
</aside>

`define_component` creates a component that represents a value.

This is how you define a component that holds data, which you'll use to type-safely access and modify state in your systems.

```typescript
import { define_component, define_tag } from "@glom/ecs"

const Position = define_component<{ x: number; y: number }>()
const Velocity = define_component<{ dx: number; dy: number }>()
```

`define_tag` defines a tag component, or a marker that doesn't hold any data.

```typescript
const IsPlayer = define_tag()
```

## 4. Setting up the World

The `World` is the container for all the entities and components in a simulation. When you create one, you'll need to provide a **domain ID** and a **schema**.

The **domain ID** is an integer that helps Glom manage entity creation in networked environments. By giving each peer their own ID, everyone can spawn entities at the same time without their IDs colliding. If you're building a single-player game, you can just set this to `0`.

The **schema** is a list of the components you plan to use. Glom needs this to pre-allocate storage for those components and to ensure they're identified the same way across different worlds.

To set up a `World`, import `make_world` and provide it with a unique domain ID and your component schema.

```typescript
import { make_world } from "@glom/ecs"

const schema = [Position, Velocity, IsPlayer]
const world = make_world(0, schema) // 0 is the domain ID
```

## 5. Writing Systems (with Transformer)

Systems are where you implement your logic. They are functions that receive entity queries as parameters. Declaring dependencies like `Read<Position>` allows the scheduler to determine execution order and optimize storage access.

Most systems look something like this: a function that requests a query and iterates over the results.

```typescript
import { All, Read, Write } from "@glom/ecs"

const movement_system = (
  query: All<Write<typeof Position>, Read<typeof Velocity>>
) => {
  for (const [pos, vel] of query) {
    pos.x += vel.dx
    pos.y += vel.dy
  }
}
```

## 6. Scheduling and Running

Systems are organized into a `SystemSchedule`.

The schedule uses the read and write requirements of each system to determine their execution order. Systems that write to a component are sorted to run before systems that read from the same component.

To organize your systems, import `make_system_schedule` and add your systems to it before running the schedule in your main loop.

```typescript
import { add_system, make_system_schedule, run_schedule } from "@glom/ecs"

const schedule = make_system_schedule()
add_system(schedule, movement_system)

// in your main loop
run_schedule(schedule, world)
```

## 7. Spawning Entities

Entities are discrete units, identified by a unique integer.

Entities are integer IDs that associate components. `world_flush_graph_changes` batches component additions and removals into a single pass to update the internal entity graph.

This is how you spawn an entity and attach components; remember to call `world_flush_graph_changes` to make the new entity visible to queries.

```typescript
import { add_component, spawn, world_flush_graph_changes } from "@glom/ecs"

const player = spawn(world)
add_component(world, player, Position, { x: 0, y: 0 })
add_component(world, player, Velocity, { dx: 1, dy: 1 })
add_component(world, player, IsPlayer)

// flush changes so they're available to queries
world_flush_graph_changes(world)
```

## Appendix: Without the Transformer

If you don't want to use a build step, you can define systems manually.

Some workflows might not support a build-time transformer. `define_system` lets you provide the same metadata explicitly in your code.

To manually define a system's metadata without using the transformer, use the `define_system` helper.

```typescript
import { All, Read, Write, define_system } from "@glom/ecs"

const movement_system = (query: All<Write<typeof Position>, Read<typeof Velocity>>) => {
  for (const [pos, vel] of query) {
    pos.x += vel.dx
    pos.y += vel.dy
  }
}

// manually define the system metadata
define_system(movement_system, {
  params: [
    { all: [{ write: Position }, { read: Velocity }] }
  ]
})
```
