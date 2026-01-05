# Glom

Glom is an ECS for TypeScript. It's <span class="text-examples">c</span><span class="text-guides">o</span><span class="text-general">o</span><span class="text-reference">l</span> because it includes systems, entity relationships, networking utilities, and a build-time optimizer.

<span class="text-general">Systems</span> are defined as functions. Glom uses TypeScript types to determine dependencies and handle reactivity.

```typescript
const movement = (q: All<Read<Pos>, Write<Vel>>) => {
  for (const [p, v] of q) {
    p.x += v.x
    p.y += v.y
  }
}

const contact_system = (q: All<Entity, Read<Pos>>, spawn: Spawn<Contact>) => {
  for (const [a, pa] of q) {
    for (const [b, pb] of q) {
      if (intersects(pa, pb)) {
        spawn(a, Contact(b))
      }
    }
  }
}
```

<span class="text-guides">Entity relationships</span> enable hierarchies and graphs. Relationships are represented as components.

```typescript
const Contact = define_relation()

const damage = (query: All<Write<Health>, Read<Contact>>, poof: Despawn) => {
  for (const [health, contact] of query) {
    health.value -= 10
    poof(contact)
  }
}
```

<span class="text-reference">Networking utilities</span> are mix-and-match systems and components used to replicate and reconcile state between worlds.

```typescript
// Built-in systems for reconciliation
add_system(client, g.perform_rollback)
add_system(client, g.apply_remote_transactions)
add_system(client, g.advance_world_tick)

// Tag entities for sync
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



