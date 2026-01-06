# Introduction

Glom is an Entity-Component System written in TypeScript. It aims to be a fast, networkable, and testable foundation for games with dynamic behavior.

## Features

<span class="text-guides">**Systems**</span> are just functions, so they're familiar to write and test.

```typescript
const movement = (q: All<Read<Pos>, Write<Vel>>) => {
  for (const [p, v] of q) {
    p.x += v.x
    p.y += v.y
  }
}

// in a test
const pos = {x: 0, y: 1}
const vel = {x: 1, y: 1}

movement([[pos, vel]])

expect(pos).toEqual({x: 1, y: 2})
```

<span class="text-guides">**Entity relationships**</span> help you model hierarchies and graphs.

```typescript
const Contact = defineRelation()

const collide = (query: All<Entity, Read<Pos>>, spawn: Spawn<Contact>) => {
  for (const [a, aPos] of query) {
    for (const [b, bPos] of query) {
      if (intersects(aPos, bPos)) spawn(a, Contact(b))
    }
  }
}

const damage = (query: All<Write<Health>, Read<Contact>>, poof: Despawn) => {
  for (const [health, contact] of query) {
    health.value -= 10
    poof(contact)
  }
}
```

<span class="text-guides">**Networking utilities**</span> are components and systems you can mix-and-match to replicate worlds.

```typescript
// built-in systems for reconciliation
addSystem(schedule, glom.performRollback)
addSystem(schedule, glom.applyRemoteTransactions)
addSystem(schedule, glom.advanceWorldTick)

// tag entities for sync
addComponent(world, player, Replicated)
```

The <span class="text-guides">**optimizer**</span> is a TypeScript transformer that injects system dependencies and inlines query loops.

```typescript
// @glom/transformer rewrites:
for (const [pos, vel] of query) { ... }

// into fast while loops:
let i = 0
while (i < count) {
  const pos = posStore[i]
  // ...
}
```

## Getting Started

Glom comes with many other neat things worth checking out, most of which are documented here. And you can hop straight to [the Getting Started guide](./getting_started) to start building.
