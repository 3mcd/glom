# Introduction

Glom is an Entity-Component System written in TypeScript. It's <span class="text-examples">c</span><span class="text-guides">o</span><span class="text-general">o</span><span class="text-reference">l</span> because of its testable systems, entity relationships, networking utilities, and build-time optimizer.

<span class="text-general">Systems</span> are functions. Testing them is like testing any other function.

```typescript
const movement = (q: All<Read<Pos>, Write<Vel>>) => {
  for (const [p, v] of q) {
    p.x += v.x
    p.y += v.y
  }
}

// in test
const data = [
  [{x: 0, y: 1}, {x: 1, y: 1}]
]

movement(data)

expect(data).toEqual([
  [{x: 1, y: 2}, {x: 1, y: 1}]
])
```

<span class="text-guides">Entity relationships</span> model hierarchies and graphs. Relationships are represented as components.

```typescript
const Contact = define_relation()

const collide = (q: All<Entity, Read<Pos>>, spawn: Spawn<Contact>) => {
  for (const [a, pa] of q) {
    for (const [b, pb] of q) {
      if (intersects(pa, pb)) {
        spawn(a, Contact(b))
      }
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

<span class="text-reference">Networking utilities</span> are mix-and-match systems used to replicate and reconcile state between worlds.

```typescript
// built-in systems for reconciliation
add_system(client, glom.perform_rollback)
add_system(client, glom.apply_remote_transactions)
add_system(client, glom.advance_world_tick)

// tag entities for sync
add_component(world, player, Replicated)
```

<span class="text-examples">The optimizer</span> is a build-time typescript transformer that injects system dependencies and inlines query loops.

```typescript
// @glom/transformer rewrites:
for (const [pos, vel] of query) { ... }

// Into while loops:
let i = 0
while (i < count) {
  const pos = pos_store[i]
  // ...
}
```

## Getting Started

Check out the links in the header to learn more about the different components of Glom.



