# Reactivity

Systems usually run every frame and check for entities that match a query.

Sometimes you only want to do something when a state changes, like playing a sound when a unit is created or stopping an effect when a buff ends. Glom uses `In` and `Out` **transition queries** to handle this.

## State Changes vs. Polling

Performing side effects with regular `All` queries is possible, but you'd need to read component values to avoid repeating the effect every frame.

Transition queries identify which entities changed since the last time the system ran. If you wanted to add a `ShieldVFX` when an entity gets a `Shield`, you could just use `In<typeof Shield>`.

## Reacting to Component Additions

Define queries with `In` to match entities that just started matching your criteria.

```typescript
import { Add, All, Entity, In, Read, define_component } from "@glom/ecs"

const Shield = define_component<{ power: number }>()
const ShieldVFX = define_component<{ intensity: number }>()

const on_shield_added = (
  added: In<Entity, Has<typeof Shield>>,
  add_vfx: Add<typeof ShieldVFX>
) => {
  // yields only entities that just received a shield
  for (const [entity] of added) {
    add_vfx(entity, ShieldVFX, { intensity: 1.0 })
  }
}
```

The loop only runs for entities that moved into the "has Shield" state in the current frame.

## Reacting to Component Removal

`Out` matches entities that no longer match a component signature.

```typescript
import { Entity, Out, Remove } from "@glom/ecs"

const on_shield_removed = (
  // yields only entities that just lost its shield
  removed: Out<Entity, Has<typeof Shield>>,
  remove_vfx: Remove<typeof ShieldVFX>
) => {
  for (const [entity] of removed) {
    remove_vfx(entity, ShieldVFX)
  }
}
```

## Managing Related Entities

Transition queries can also manage separate entities. In this example, we spawn a laser when a player attacks and despawn it when they stop.

```typescript
import { Add, Despawn, Entity, In, Out, Rel, Spawn, define_relation, define_tag } from "@glom/ecs"

const Attacking = define_tag()
const LaserBeam = define_tag()
const EmitsFrom = define_relation()

// spawn a beam and link it
const on_attack_started = (
  added: In<Entity, typeof Attacking>,
  spawn: Spawn<Beam, EmitsFrom>,
  bind: Add<EmitsFrom>
) => {
  for (const [player] of added) {
    spawn(spawner, LaserBeam, EmitsFrom(player))
  }
}

// find the beam and despawn it
const on_attack_stopped = (
  removed: Out<Entity, Rel<typeof EmitsFrom, Has<typeof Attacking>>>,
  despawn: Despawn
) => {
  for (const [beam] of removed) {
    despawn(beam)
  }
}
```

In `on_attack_stopped`, the `Out` query yields entities that no longer emit from attacking entities, which means they can be cleaned up.

## How it works

Transition queries subscribe to changes in the [Entity Graph](./entity_graph). When an entity moves between nodes, the graph notifies the queries.

Each query keeps track of which entities entered or left its scope. These lists are cleared after the system runs.

## Manual Definition

If you aren't using the transformer, you provide the `in` or `out` descriptors in the system metadata.

```typescript
import { In, Read, define_system } from "@glom/ecs"

const on_position_added = define_system((added: In<Read<typeof Position>>) => {
  for (const [pos] of added) {
    // ...
  }
}, {
  params: [
    { in: [{ read: Position }] }
  ]
})
```
