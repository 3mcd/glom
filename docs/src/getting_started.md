# Getting Started

This guide walks you through building a complete, reactive application in Glom. We will build a small logic loop where players move around and collect items, triggering sound effects reactively.

## Installation

Install the core ECS package:

```bash
bun add @glom/ecs
```

We recommend using the build-time transformer to enable idiomatic TypeScript signatures:

```bash
# if using Bun
bun add -d @glom/transformer-bun

# if using Vite / Rollup
bun add -d @glom/transformer-rollup
```

## 1. Setting up the Transformer

Glom uses a build-time transformer to inline query loops and infer system dependencies.

### For Bun

```typescript
import { glomBunPlugin } from "@glom/transformer-bun"

Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  plugins: [glomBunPlugin()],
})
```

### For Vite / Rollup

```typescript
import { defineConfig } from "vite"
import { glomRollupPlugin } from "@glom/transformer-rollup"

export default defineConfig({
  plugins: [glomRollupPlugin()],
})
```

## 2. Defining Components

Components are plain data structures. Use `defineComponent` for data and `defineTag` for markers.

```typescript
import { defineComponent, defineTag, defineRelation, Entity } from "@glom/ecs"

// Data components
const Pos = defineComponent<{ x: number; y: number }>()
const Vel = defineComponent<{ dx: number; dy: number }>()
const Sfx = defineComponent<{ clip: string }>()

// Tags (markers)
const Player = defineTag()
const Item = defineTag()
const Collected = defineTag()
const SfxManager = defineTag()

// Relationships
const PlaysOn = defineRelation()
```

## 3. Writing Systems

Systems are functions that implement your logic. They use iterable **queries** to find entities.

### The Movement System (Standard Query)
Uses `All` to iterate over every entity that has both `Pos` and `Vel`.

```typescript
import { All, Write } from "@glom/ecs"

const movePlayers = (
  query: All<Write<typeof Pos>, typeof Vel>
) => {
  for (const [pos, vel] of query) {
    pos.x += vel.dx
    pos.y += vel.dy
  }
}
```

### The Collection System (Cross-Query)
Identifies when a player is close enough to an item to "collect" it.

```typescript
import { Add, Entity, All } from "@glom/ecs"

const collectItems = (
  players: All<typeof Pos, typeof Player>,
  items: All<Entity, typeof Pos, typeof Item>,
  collect: Add<typeof Collected>
) => {
  for (const [pPos] of players) {
    for (const [item, iPos] of items) {
      const dist = Math.hypot(pPos.x - iPos.x, pPos.y - iPos.y)
      if (dist < 1.0) {
        collect(item)
      }
    }
  }
}
```

### Reactive Systems (In/Out Monitors)
Glom provides `In` and `Out` monitors to react to state changes.

```typescript
import { In, Out, Spawn, Despawn, Add, Unique } from "@glom/ecs"

// despawn items as soon as they are collected
const despawnCollected = (
  items: In<typeof Collected>,
  despawn: Despawn
) => {
  for (const [entity] of items) {
    despawn(entity)
  }
}

// play a sound when an item is removed from the world
const playPickupSfx = (
  removedItems: Out<typeof Item>,
  spawn: Spawn<typeof Sfx>,
  play: Add<typeof PlaysOn>,
  // `Unique` identifies a single entity matching the criteria
  [manager]: Unique<Entity, typeof SfxManager>
) => {
  for (const [entity] of removedItems) {
    // spawn a temporary sound entity
    const sfx = spawn(Sfx({ clip: "pickup.wav" }))
    // link it to the global SFX manager entity
    play(sfx, PlaysOn, manager)
  }
}
```

## 4. Scheduling and Running

Systems are organized into a `SystemSchedule`. Glom automatically sorts them based on their data requirements.

```typescript
import { makeWorld, makeSystemSchedule, addSystem, runSchedule } from "@glom/ecs"

const world = makeWorld()
const schedule = makeSystemSchedule()

addSystem(schedule, movePlayers)
addSystem(schedule, collectItems)
addSystem(schedule, despawnCollected)
addSystem(schedule, playPickupSfx)

// initialize our world
import { spawn, addComponent, addResource, flushGraphChanges } from "@glom/ecs"

// create the global SFX singleton
const manager = spawn(world)
addComponent(world, manager, SfxManager)

// spawn a player
const p = spawn(world)
addComponent(world, p, Player)
addComponent(world, p, Pos, { x: 0, y: 0 })
addComponent(world, p, Vel, { dx: 0.1, dy: 0.1 })

// spawn an item
const i = spawn(world)
addComponent(world, i, Item)
addComponent(world, i, Pos, { x: 5, y: 5 })

flushGraphChanges(world)
```

## 5. The Main Loop (Fixed Timestep)

For predictable logic, use a fixed timestep loop.

```typescript
import { makeTimestep, advanceTimestep } from "@glom/ecs"

const timestep = makeTimestep(60) // 60fps logic

function loop() {
  const now = performance.now()
  
  // step the logic in fixed increments
  advanceTimestep(timestep, now, (delta) => {
    runSchedule(schedule, world)
  })
  
  requestAnimationFrame(loop)
}

loop()
```

## Summary

In this example, we:

1. Defined components, including tags and relations.
2. Built systems using `All`, `In`, and `Out` queries.
3. Utilized system arguments (`Spawn`, `Add`, `Despawn`) to modify world state inside systems.
4. Created a singleton using `addResource`.
5. Set up a system schedule and a fixed game loop.
