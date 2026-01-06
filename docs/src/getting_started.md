# Getting Started

This guide explains how to set up Glom and the reasoning behind its core patterns.

## Installation

Install the core ECS package first:

```bash
bun add @glom/ecs
```

You'll also need the corresponding plugin for your bundler if you plan on using the build-time transformer:

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

Register the `glomBunPlugin` in your build configuration to use the transformer with Bun.

```typescript
import { glomBunPlugin } from "@glom/transformer-bun"

Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  plugins: [glomBunPlugin()],
})
```

### For Vite / Rollup

Add the `glomRollupPlugin` to your plugins list to use the transformer with Vite or Rollup.

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

Entities are simple integer IDs. They don't encapsulate any logic or data themselves; instead, they act as a pointer to a set of component instances. A component instance is a plain value that represents a specific aspect of an entity, such as its position, health, or a player tag.

The logic of your application is contained within systems, which are functions that operate on entities matching specific component criteria. A movement system might update the position of every entity that has both a position and a velocity component, for example. All of these entities and components are managed by the world, the central container that your systems run logic against.


<aside>
  <p>Each world uses an [Entity Graph](./entity_graph) to organize entities based on their component signatures, allowing systems to efficiently find their matches without scanning the entire world.</p>
</aside>

## 3. Defining Components

Components define the shape of game state. When you add a component to an entity, you need to provide a **component instance**. They can be any JavaScript data type.

Each entity can have only one instance of a specific component type at a time. An entity can't have two `Position` components, for example.

<aside>
  <p>You can achieve something close to entities with multiple components with [relationships](./relationships).</p>
</aside>

`defineComponent` creates a component that holds data, which you'll use to access and modify state in your systems.

```typescript
import { defineComponent, defineTag } from "@glom/ecs"

const Position = defineComponent<{ x: number; y: number }>()
const Velocity = defineComponent<{ dx: number; dy: number }>()
```

`defineTag` defines a tag component, or a marker that doesn't hold any data.

```typescript
const IsPlayer = defineTag()
```

## 4. Setting up the World

The `World` is the container for all the entities and components in an application.

Create a world by calling `makeWorld`.

```typescript
import { makeWorld } from "@glom/ecs"

const world = makeWorld()
```

## 5. Writing Systems (with Transformer)

Systems are functions where you implement your logic. They receive entity queries as parameters, and declaring dependencies like `Position` allows the scheduler to determine execution order.

```typescript
import { All, Read, Write } from "@glom/ecs"

const movementSystem = (
  query: All<Write<typeof Position>, typeof Velocity>
) => {
  for (const [pos, vel] of query) {
    pos.x += vel.dx
    pos.y += vel.dy
  }
}
```

## 6. Scheduling and Running

Systems are organized into a `SystemSchedule`, which uses `Read` and `Write` requirements to determine their execution order. Systems that write to a component are sorted to run before systems that read from the same component.

Add your systems to a schedule and run it in your main loop:

```typescript
import { addSystem, makeSystemSchedule, runSchedule } from "@glom/ecs"

const schedule = makeSystemSchedule()
addSystem(schedule, movementSystem)

// in your main loop
runSchedule(schedule, world)
```

## 7. Spawning Entities

Entities are unique integer IDs that associate components. When you spawn an entity or change its components, call `flushGraphChanges` to update the internal entity graph and make those changes visible to queries.

```typescript
import { addComponent, spawn, flushGraphChanges } from "@glom/ecs"

const player = spawn(world)
addComponent(world, player, Position, { x: 0, y: 0 })
addComponent(world, player, Velocity, { dx: 1, dy: 1 })
addComponent(world, player, IsPlayer)

// flush changes so they're available to queries
flushGraphChanges(world)
```

Within a system, you use the `Spawn` and `Add` descriptors to perform these operations:

```typescript
import { Add, Spawn } from "@glom/ecs"

const playerSpawner = (spawn: Spawn, addPosition: Add<typeof Position>) => {
  const player = spawn([IsPlayer])
  addPosition(player, { x: 0, y: 0 })
}
```

## 8. Despawning and Removing Components

Removing data or entities is just as straightforward.

```typescript
import { despawn, removeComponent } from "@glom/ecs"

// remove a single component
removeComponent(world, player, Velocity)

// remove the entire entity
despawn(world, player)
```

And the system equivalents using `Remove` and `Despawn`:

```typescript
import { Despawn, Remove } from "@glom/ecs"

const cleanupSystem = (
  query: All<Entity, Has<typeof IsDead>>,
  remove: Remove<typeof IsDead>,
  despawn: Despawn
) => {
  for (const [entity] of query) {
    remove(entity)
    despawn(entity)
  }
}
```

## Appendix: Without the Transformer

If your workflow doesn't support a build-time transformer, you can use the `defineSystem` helper to provide metadata explicitly in your code.

```typescript
import { All, Read, Write, defineSystem } from "@glom/ecs"

const movementSystem = (query: All<Write<typeof Position>, typeof Velocity>) => {
  for (const [pos, vel] of query) {
    pos.x += vel.dx
    pos.y += vel.dy
  }
}

// manually define the system metadata
defineSystem(movementSystem, {
  params: [
    { all: [{ write: Position }, { read: Velocity }] }
  ]
})
```
