import type {Component, ComponentLike} from "./component"
import type {Entity} from "./entity"

export type Relation = Component<void> & ((object: Entity) => Relationship)

export type Relationship = ComponentLike & {
  relation: Relation
  object: Entity
}

export function define_relation(id?: number): Relation {
  const rel = ((object: Entity): Relationship => {
    return {
      relation: rel as unknown as Relation,
      object,
    } as Relationship
  }) as unknown as Record<string, unknown>
  if (id !== undefined) rel.id = id
  rel.is_tag = true
  rel.__component_brand = true
  return rel as unknown as Relation
}

export function is_relation(component: unknown): component is Relation {
  return (
    typeof component === "function" &&
    component !== null &&
    ("__component_brand" in (component as any) || "id" in (component as any))
  )
}

export function is_relationship(item: unknown): item is Relationship {
  return (
    typeof item === "object" &&
    item !== null &&
    "relation" in item &&
    is_relation((item as Relationship).relation)
  )
}
