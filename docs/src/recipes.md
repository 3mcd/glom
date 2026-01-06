# Recipes

This page provides common patterns and snippets for working with Glom ECS.

## Basic Queries

### Find all entities with specific components
Use `All` to iterate through every entity that matches a component signature.

```typescript
import { All, Read, Write } from "@glom/ecs"

const moveSystem = (query: All<Write<typeof Position>, Read<typeof Velocity>>) => {
  for (const [pos, vel] of query) {
    pos.x += vel.dx
    pos.y += vel.dy
  }
}
```

### Find a unique entity (Singletons)
Use `Unique` to access a single entity that you know exists, such as a global game state or a manager.

```typescript
import { Unique, Read } from "@glom/ecs"

const scoreSystem = ([game]: Unique<Read<typeof GameState>>) => {
  console.log("Current Score:", game.score)
}
```

## Reactive Queries

### Perform an action once when a component is added
Use `In` to catch entities that just started matching a signature.

```typescript
import { In, Entity, Spawn, defineTag, defineRelation } from "@glom/ecs"

const Vfx = defineTag()
const LeveledUp = defineTag()
const EmitsFrom = defineRelation()

const onLevelUp = (added: In<Entity, typeof LeveledUp>, spawn: Spawn<typeof Vfx>) => {
  for (const [entity] of added) {
    // spawn a particle effect at the leveled-up entity
    spawn([Vfx, EmitsFrom(entity)])
  }
}
```

### Clean up resources when a component is removed
Use `Out` to catch entities that no longer match a signature.

```typescript
import { Out, Entity, Despawn } from "@glom/ecs"

const onShieldRemoved = (removed: Out<Entity, typeof Shield>, despawn: Despawn) => {
  for (const [entity] of removed) {
    // ...
  }
}
```

## Joins and Relationships

### Combine two disjoint sets (Cartesian Product)
Use `Join` with two `All` queries to find all combinations of two sets of entities.

```typescript
import { Join, All, Entity, Read } from "@glom/ecs"

const collide = (query: Join<All<Entity, typeof Pos>, All<Entity, typeof Pos>>) => {
  for (const [e1, p1, e2, p2] of query) {
    if (e1 === e2) continue // skip self-collision
    const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y)
    if (dist < 1.0) {
      // handle collision
    }
  }
}
```

### Find related entities (Relational Join)
Use `Join` with a third argument to find entities linked by a relationship.

```typescript
import { Join, All, Entity, defineRelation } from "@glom/ecs"

const ChildOf = defineRelation()

const updateChildren = (query: Join<All<typeof Position>, All<typeof Position>, typeof ChildOf>) => {
  for (const [childPos, parentPos] of query) {
    childPos.absoluteX = parentPos.x + childPos.relativeX
    childPos.absoluteY = parentPos.y + childPos.relativeY
  }
}
```

### Garbage collect linked entities
Use `Out` wrapping a relational `Join` to automatically clean up "child" entities when their "parent" no longer matches a condition (or is despawned).

```typescript
import { Out, Join, All, Entity, Has, Despawn, defineRelation, defineTag } from "@glom/ecs"

const Attacking = defineTag()
const EmitsFrom = defineRelation()

const cleanupBeams = (
  removed: Out<Join<All<Entity>, All<Has<typeof Attacking>>, typeof EmitsFrom>>,
  despawn: Despawn
) => {
  // This triggers if the player stops attacking, or if either entity is despawned
  for (const [beam] of removed) {
    despawn(beam)
  }
}
```

## World API

### Add a component to an existing entity
Inside a system, use the `Add` descriptor.

```typescript
import { Add, Entity, defineTag } from "@glom/ecs"

const MyTag = defineTag()

const mySystem = (query: All<Entity>, add: Add<typeof MyTag>) => {
  for (const [entity] of query) {
    add(entity)
  }
}
```

### Spawn an entity with initial components
Use the `Spawn` descriptor. You can optionally use `Spawn<typeof Component>` to inform the scheduler about which components this system will be adding to the world.

```typescript
import { Spawn, defineComponent } from "@glom/ecs"

const Pos = defineComponent<{x: number, y: number}>()

const spawnSystem = (spawn: Spawn<typeof Pos>) => {
  const entity = spawn([Pos({x: 0, y: 0})])
}
```

