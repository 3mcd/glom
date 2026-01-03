import type { Component, ComponentLike } from "./component"
import type { Entity } from "./entity"

export type Relation = Component<void> & ((object: Entity) => Relationship)

export type Relationship = ComponentLike & {
  relation: Relation
  object: Entity
}

export function define_relation(id: number): Relation {
  const rel = ((object: Entity): Relationship => {
    return {
      relation: rel as unknown as Relation,
      object,
    } as Relationship
  }) as unknown as Record<string, unknown>
  rel["id"] = id
  rel["is_tag"] = true
  rel["__component_brand"] = true
  return rel as unknown as Relation
}

export function is_relation(component: ComponentLike): component is Relation {
  return (
    typeof component === "function" &&
    "id" in component &&
    Reflect.get(component, "id") !== undefined
  )
}

export function is_relationship(
  component: ComponentLike,
): component is Relationship {
  return (
    typeof component === "object" &&
    component !== null &&
    "relation" in component &&
    is_relation((component as Relationship).relation)
  )
}
