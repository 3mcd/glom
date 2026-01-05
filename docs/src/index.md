# Introduction

Glom is an Entity-Component System written in TypeScript. It aims to be a fast, networkable, and testable foundation for games with dynamic needs.

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
const Contact = define_relation()

const collide = (query: All<Entity, Read<Pos>>, spawn: Spawn<Contact>) => {
  for (const [a, a_pos] of query) {
    for (const [b, b_pos] of query) {
      if (intersects(a_pos, b_pos)) spawn(a, Contact(b))
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
add_system(schedule, glom.perform_rollback)
add_system(schedule, glom.apply_remote_transactions)
add_system(schedule, glom.advance_world_tick)

// tag entities for sync
add_component(world, player, Replicated)
```

The <span class="text-guides">**optimizer**</span> is a TypeScript transformer that injects system dependencies and inlines query loops.

```typescript
// @glom/transformer rewrites:
for (const [pos, vel] of query) { ... }

// into fast while loops:
let i = 0
while (i < count) {
  const pos = pos_store[i]
  // ...
}
```

## Getting Started

Check out the links in the header to learn more, or hop straight to [Getting Started](./getting_started) to get up and running with Glom.



