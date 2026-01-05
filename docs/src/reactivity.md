# Reactivity

Systems usually run every frame and check for entities that match a query.

Sometimes you only want to do something when a state changes, like playing a sound when a unit is created or stopping an effect when a buff ends. Glom uses `In` and `Out` wrappers to handle this.

## State Changes vs. Polling

If you want to add a `ShieldVFX` when an entity gets a `Shield`, a normal system would try to add the VFX every frame. You would have to check if the VFX is already there to avoid duplicates.

Reactivity identifies which entities changed since the last time the system ran.

## Reacting to Component Additions

Wrap your query in `In` to match entities that just started matching your criteria.

```typescript
import { All, Read, In, Add, Entity, add_component, define_component } from "@glom/ecs"

const Shield = define_component<{ power: number }>()
const ShieldVFX = define_component<{ intensity: number }>()

// Runs only for entities that just received a Shield
const on_shield_added = (
  added: In<Entity, Has<typeof Shield>>,
  add_vfx: Add<typeof ShieldVFX>
) => {
  for (const [entity] of added) {
    add_vfx(entity, ShieldVFX, { intensity: 1.0 })
  }
}
```

The loop only runs for entities that moved into the "has Shield" state in the current frame.

## Reacting to Component Removal

`Out` matches entities that no longer meet your criteria.

`Out` queries provide the last known values of the components. This is useful for cleanup logic.

```typescript
import { Out, Remove, Entity } from "@glom/ecs"

// Runs when an entity loses its Shield
const on_shield_removed = (
  removed: Out<Entity, Has<typeof Shield>>,
  remove_vfx: Remove<typeof ShieldVFX>
) => {
  for (const [entity] of removed) {
    remove_vfx(entity, ShieldVFX)
  }
}
```

## Managing Related Entities

Reactivity can also manage separate entities. In this example, we spawn a laser when a player attacks and despawn it when they stop.

```typescript
import { In, Out, Rel, Spawn, Despawn, Entity, despawn, add_component, define_tag, define_relation } from "@glom/ecs"

const Attacking = define_tag()
const LaserBeam = define_tag()
const HasBeam = define_relation()

// Spawn a beam and link it
const on_attack_started = (
  added: In<Entity, typeof Attacking>,
  spawn: Spawn<Beam>
) => {
  for (const [player] of added) {
    const beam = spawn(spawner, LaserBeam)
    add_component(player, HasBeam(beam))
  }
}

// Find the beam and despawn it
const on_attack_stopped = (
  removed: Out<Rel<typeof HasBeam, Entity>, typeof Attacking>,
  despawn: Despawn
) => {
  for (const [beam] of removed) {
    despawn(beam)
  }
}
```

In `on_attack_stopped`, the `Out` query provides the state of the player as it was before the attack stopped. This lets us find the `HasBeam` relation even though the `Attacking` tag is gone.

## How it works

Reactivity is built into the Entity Graph. Queries subscribe to changes in the graph. When an entity moves between nodes, the graph notifies the queries.

Each query keeps track of which entities entered or left its scope. These lists are cleared after the system runs.

## Manual Definition

If you aren't using the transformer, you provide the `in` or `out` descriptors in the system metadata.

```typescript
import { define_system, In, Read } from "@glom/ecs"

const on_position_added = define_system((added: In<Read<typeof Position>>) => {
  for (const [pos] of added) {
    // ...
  }
}, {
  params: [
    { in: { all: [{ read: Position }] } }
  ]
})
```
