# Entity Relationships

Storing an entity ID inside a component (e.g., a `Parent` component on a child entity) is one way to link entities, but it can make it difficult to find all entities that point to a specific target.

Glom provides built-in support for these links. Relationships provide the means to model hierarchies (parent/child), track ownership (bag/item), and represent abstract links (targeting/grouping).

## Defining a Relation

Use the `defineRelation` helper to define a kind of link between your entities.

```typescript
import { defineRelation } from "@glom/ecs"

const ChildOf = defineRelation()
```

## Creating Relationships

A relationship is an instance of a relation component. They can be thought of as a pairing of `(relation, object)`, where `relation` is the link type and `object` is the target of the relationship.

Use `addComponent` and invoke the relation with a single target entity to create a relationship.

```typescript
import { addComponent, spawn } from "@glom/ecs"

const parent = spawn(world)
const child = spawn(world)

// the child now has a relationship pointing to its parent
addComponent(world, child, ChildOf(parent))

// within a system:
const linkSystem = (spawn: Spawn) => {
  const parent = spawn([])
  const child = spawn([ChildOf(parent)])
}
```

## Querying Relationships

Use the `Rel` descriptor in your system query to extract components from both the source and the target entities to find entities with a specific relationship.

```typescript
import { All, Entity, Read, Rel } from "@glom/ecs"

// find all child entities and fetch their parents
const followParentSystem = (
  query: All<Read<Position>, Rel<typeof ChildOf, Read<Position>>>
) => {
  for (const [childPos, parentPos] of query) {
    childPos.x = parentPos.x
    childPos.y = parentPos.y
  }
}
```

## How they work

Relationships are integrated into the [Entity Graph](./entityGraph). Adding a relationship to an entity moves it to a node in the graph that represents that specific relationship type and target.

Queries can locate related entities without searching through the entire world because these links are part of the graph structure. This also means [Transition Queries](./reactivity) can track relationship changes just as they track component changes.
