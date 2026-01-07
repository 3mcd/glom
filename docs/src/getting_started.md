# Getting Started

This guide walks through building a basic application. We'll build a "game" where players move around and collect items, triggering sound effects reactively.

## Installation

Install the core ECS package:

```bash
bun add @glom/ecs
```

Use the build-time transformer to enable idiomatic TypeScript signatures:

```bash
# if using Bun
bun add -d @glom/transformer-bun

# if using Vite / Rollup
bun add -d @glom/transformer-rollup
```

## 1. Setting up the Transformer

The build-time transformer inlines query loops and infers system dependencies.

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

Components represent data that can be added to an entity. Each component type acts like a "slot" on an entity; an entity can have only one instance of a specific component at a time. 

Use `defineComponent` for data and `defineTag` for markers (data-less components).

```typescript
import { defineComponent, defineTag, defineRelation, Entity } from "@glom/ecs"

// data components
const Pos = defineComponent<{ x: number; y: number }>()
const Vel = defineComponent<{ dx: number; dy: number }>()
const Sfx = defineComponent<{ clip: string }>()

// tags (labels, or dataless components)
const Player = defineTag()
const Item = defineTag()
const Collected = defineTag()
const SfxManager = defineTag()

// relationships
const PlaysOn = defineRelation()
```

## 3. Writing Systems

Systems are functions that implement your logic. They use iterable **queries** to find entities.

### Moving Players

Let's write our first system:

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

The `movePlayers` system uses the `All` query to find entities that have both a `Pos` and a `Vel`. By wrapping `Pos` in `Write`, we inform the scheduler that this system intended to modify position data, which helps determine the correct execution order relative to other systems.



### Collecting Items

Our next system demonstrates a **cross-join** pattern. Instead of nesting two loops manually, we can use `Join` to iterate through all combinations of players and items. When a player is close enough, we use the `Add` descriptor to tag the item as `Collected`. 

```typescript
import { Add, Entity, All, Join } from "@glom/ecs"

// iterate through all combinations of players and items
type Query = Join<
  All<typeof Pos, typeof Player>,
  All<Entity, typeof Pos, typeof Item>
>

const collectItems = (query: Query, collect: Add<typeof Collected>) => {
  for (const [pPos, item, iPos] of query) {
      const dist = Math.hypot(pPos.x - iPos.x, pPos.y - iPos.y)
      if (dist < 1.0) {
        collect(item)
    }
  }
}
```

Adding this `Collected` tag moves the item to a different node in the entity graph, which our reactive systems can then pick up.

### Reactive Systems (In/Out Monitors)

Use `In` and `Out` monitors to react to entities entering or leaving a specific component signature. 

This `despawnCollected` system reacts to entities that just received the `Collected` tag, immediately removing them from the world. 

```typescript
import { In, Despawn } from "@glom/ecs"

// despawn items as soon as they are collected
const despawnCollected = (
  items: In<typeof Collected>,
  despawn: Despawn
) => {
  for (const [entity] of items) {
    despawn(entity)
  }
}
```

We'll add a `playPickupSfx` system to react to entities that just lost their `Item` tag (because they were despawned). It uses the `Unique` query to find the global `SfxManager` and links a new, temporary sound entity to it using the `PlaysOn` relationship.

```typescript
import { Out, Spawn, Add, Unique } from "@glom/ecs"

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

### Relationships and Related Queries

To process the sound effects we just spawned, we can use a relational `Join`. This allows us to find entities based on their relationships to other entities. Here, we find all `Sfx` entities that are linked to the `SfxManager` via the `PlaysOn` relation. After processing the sound, we despawn the ephemeral sound entity.

```typescript
import { Join } from "@glom/ecs"

const processSfx = (
  // finds entities with Sfx that play on the SfxManager
  query: Join<All<Entity, typeof Sfx>, All<typeof SfxManager>, typeof PlaysOn>,
  despawn: Despawn
) => {
  for (const [entity, sfx] of query) {
    // trigger sound playback here
    console.log("playing sound", sfx.clip)

    // cleanup the ephemeral sound entity after processing
    despawn(entity)
  }
}
```

## 4. Scheduling and Running

Systems are organized into a `SystemSchedule`. The scheduler analyzes the `Read` and `Write` dependencies of each system to automatically determine an execution order that avoids data races. In the setup below, we initialize the world with our global manager, a player, and an item.

```typescript
import { makeWorld, makeSystemSchedule, addSystem, runSchedule } from "@glom/ecs"

const world = makeWorld()
const schedule = makeSystemSchedule()

addSystem(schedule, movePlayers)
addSystem(schedule, collectItems)
addSystem(schedule, despawnCollected)
addSystem(schedule, playPickupSfx)
addSystem(schedule, processSfx)

// initialize our world
import { spawn, addResource, flushGraphChanges } from "@glom/ecs"

// create the global SFX singleton
const manager = spawn(world, SfxManager)

// spawn a player
const p = spawn(world, Player, Pos({ x: 0, y: 0 }), Vel({ dx: 0.1, dy: 0.1 }))

// spawn an item
const i = spawn(world, Item, Pos({ x: 5, y: 5 }))

flushGraphChanges(world)
```

## 5. The Main Loop (Fixed Timestep)

A fixed loop ensures that physics and logic remain consistent regardless of the rendering framerate. `advanceTimestep` will run the provided callback (containing our schedule execution) as many times as necessary to catch up with the current time.

```typescript
import { makeTimestep, advanceTimestep } from "@glom/ecs"

const timestep = makeTimestep(60) // run at ~60hz

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
