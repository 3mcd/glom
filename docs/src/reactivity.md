# Reactivity

Systems usually run every frame and check for entities that match a query.

Sometimes you only want to do something when a state changes, like playing a sound when a unit is created or stopping an effect when a buff ends. Glom uses `In` and `Out` transition queries to handle this.

## State Changes vs. Polling

Performing side effects with regular `All` queries is possible, but you'd need to read component values to avoid repeating the effect every frame.

Transition queries identify which entities changed since the last time the system ran. You could just use `In<typeof Shield>` if you wanted to add a `ShieldVFX` when an entity gets a `Shield`.

## Reacting to Component Additions

Define queries with `In` to match entities that just started matching your criteria.

```typescript
import { Add, All, Entity, In, Read, defineComponent } from "@glom/ecs"

const Shield = defineComponent<{ power: number }>()
const ShieldVFX = defineComponent<{ intensity: number }>()

const onShieldAdded = (
  added: In<Entity, Has<typeof Shield>>,
  addVfx: Add<typeof ShieldVFX>
) => {
  // yields only entities that just received a shield
  for (const [entity] of added) {
    addVfx(entity, { intensity: 1.0 })
  }
}
```

The loop only runs for entities that moved into the "has Shield" state in the current frame.

## Reacting to Component Removal

`Out` matches entities that no longer match a component signature.

```typescript
import { Entity, Out, Remove } from "@glom/ecs"

const onShieldRemoved = (
  // yields only entities that just lost its shield
  removed: Out<Entity, Has<typeof Shield>>,
  removeVfx: Remove<typeof ShieldVFX>
) => {
  for (const [entity] of removed) {
    removeVfx(entity)
  }
}
```

## Managing Related Entities

Transition queries can also manage separate entities. This example demonstrates spawning a laser when a player begins attacking, and despawning it when they stop.

```typescript
import { Despawn, Entity, In, Out, Rel, Spawn, defineRelation, defineTag } from "@glom/ecs"

const Attacking = defineTag()
const LaserBeam = defineTag()
const EmitsFrom = defineRelation()

// spawn a beam and link it
const onAttackStarted = (
  added: In<Entity, typeof Attacking>,
  spawn: Spawn
) => {
  for (const [player] of added) {
    spawn([LaserBeam, EmitsFrom(player)])
  }
}

// find the beam and despawn it
const onAttackStopped = (
  removed: Out<Entity, Rel<typeof EmitsFrom, Has<typeof Attacking>>>,
  despawn: Despawn
) => {
  for (const [beam] of removed) {
    despawn(beam)
  }
}
```

The world API equivalents for these operations:

```typescript
// spawning with initial components
const beam = spawn(world, [LaserBeam, EmitsFrom(player)])

// despawning
despawn(world, beam)
```

The `Out` query yields entities that no longer emit from attacking entities in `onAttackStopped`, which means they can be cleaned up.

### How it works

Transition queries subscribe to changes in the [Entity Graph](./entityGraph). The graph notifies the queries when an entity moves between nodes.

Each query keeps track of which entities entered or left its scope. These lists are cleared after the system runs.

## Manual Definition

Provide the `in` or `out` descriptors in the system metadata if you aren't using the transformer.

```typescript
import { In, Read, defineSystem } from "@glom/ecs"

const onPositionAdded = defineSystem((added: In<typeof Position>) => {
  for (const [pos] of added) {
    // ...
  }
}, {
  params: [
    { in: [{ read: Position }] }
  ]
})
```
