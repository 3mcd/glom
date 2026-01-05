# Reactivity Guide

Systems usually run every frame, polling for entities that match a specific component signature. This is good for iteration.

However, some game features are event-driven: you might want to play a sound when a unit is created, or clean up a particle effect when a buff expires. Glom provides reactivity through `In` and `Out` query wrappers, allowing you to write systems that execute exactly when an entity enters or leaves a state.

## The Problem: State Changes vs. Polling

Imagine you are building a shield system. When an entity receives a `Shield` component, you want to add a `ShieldVFX` component to enable a visual shader. If you use a standard query, your system will run every frame for every shielded entity, repeatedly trying to add the component. You would then need to manually track whether the VFX is already present, adding boilerplate to your logic.

Reactivity handles this by identifying which entities changed since the last time the system ran.

## Reacting to Component Additions

To respond to a component being added, you wrap your query in the `In` type. In this example, when a `Shield` is added to an entity, we respond by adding a `ShieldVFX` component to enable its visual representation.

```typescript
import { All, Read, In, Add, Entity, add_component, define_component } from "@glom/ecs"

const Shield = define_component<{ power: number }>()
const ShieldVFX = define_component<{ intensity: number }>()

// This system only iterates over entities that just received a Shield
const on_shield_added = (
  added: In<Entity, Has<typeof Shield>>,
  add_vfx: Add<typeof ShieldVFX>
) => {
  for (const [entity] of added) {
    add_vfx(entity, ShieldVFX, { intensity: 1.0 })
  }
}
```

Because `added` is an `In` query, the loop only executes for entities that moved into the "has Shield" state in the current frame.

## Reacting to Component Removal

The mirror of `In` is `Out`. This matches entities that no longer meet your query's criteria—for example, because the `Shield` component was removed.

A key feature of `Out` queries is that the component data is still accessible in the loop. Glom provides the last known values of the removed components, which is useful for cleanup. In our shield example, we use the `Remove` argument to strip the VFX component when the shield expires.

```typescript
import { Out, Remove, Entity } from "@glom/ecs"

// This system runs when an entity loses its Shield
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

Reactivity is also used to manage the lifecycle of entirely separate entities. In this example, when a player starts attacking, we spawn a laser entity. When they stop, we despawn that specific laser.

We can use **Relationships** to link the player to their laser, making it easy to find and cleanup.

```typescript
import { In, Out, Rel, Spawn, Despawn, Entity, despawn, add_component, define_tag, define_relation } from "@glom/ecs"

const Attacking = define_tag()
const LaserBeam = define_tag()
const HasBeam = define_relation()

// When a player starts attacking, spawn a beam and link it
const on_attack_started = (
  added: In<Entity, typeof Attacking>,
  spawn: Spawn<Beam>
) => {
  for (const [player] of added) {
    const beam = spawn(spawner, LaserBeam)
    add_component(player, HasBeam(beam))
  }
}

// When the attack stops, find the beam and despawn it
const on_attack_stopped = (
  removed: Out<Rel<typeof HasBeam, Entity>, typeof Attacking>,
  despawn: Despawn
) => {
  for (const [beam] of removed) {
    despawn(beam)
  }
}
```

In the `on_attack_stopped` example, the `Out` query captures the state of the player exactly as it was before they stopped attacking. This allows us to resolve the `HasBeam` relation to get the `beamEntity` ID, even though the `Attacking` state is already gone.

## How it Works

Glom implements reactivity through an incremental, event-driven model integrated with the Entity Graph. Reactive queries subscribe to changes in the graph that match their requirements. When an entity's component composition changes, the graph triggers updates for the affected queries.

Each query tracks the entities that have entered or left its criteria since the query last ran. These changes are processed during the system execution and then cleared, ensuring that only changes occurring between runs are captured.

## Manual Definition

If you are not using the transformer, you can define these reactive systems by explicitly providing the `in` or `out` descriptors.

```typescript
import { define_system, In, Read } from "@glom/ecs"

const on_position_added = define_system((added: In<Read<typeof Position>>) => {
  for (const [pos] of added) {
    // Your logic here
  }
}, {
  params: [
    { in: { all: [{ read: Position }] } }
  ]
})
```
