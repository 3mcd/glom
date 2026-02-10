import type {Component, ComponentLike} from "./component"
import {registerGlobalComponent} from "./component"
import type {Entity} from "./entity"
import {hashNameToComponentId} from "./lib/hash"

export type Relation = Component<void> & ((object: Entity) => Relationship)

export type Relationship = ComponentLike & {
  relation: Relation
  object: Entity
}

export function defineRelation(name: string): Relation {
  const rel = ((object: Entity): Relationship => {
    return {
      relation: rel as unknown as Relation,
      object,
    } as Relationship
  }) as unknown as Record<string, unknown>

  const componentId = hashNameToComponentId(name)
  Object.defineProperty(rel, "name", {
    value: name,
    writable: false,
    configurable: true,
  })
  rel.id = componentId
  rel.isTag = true
  rel.__component_brand = true

  registerGlobalComponent(componentId, undefined, true)

  return rel as unknown as Relation
}

export function isRelation(component: unknown): component is Relation {
  return (
    typeof component === "function" &&
    component !== null &&
    ("__component_brand" in (component as any) || "id" in (component as any))
  )
}

export function isRelationship(item: unknown): item is Relationship {
  return (
    typeof item === "object" &&
    item !== null &&
    "relation" in item &&
    isRelation((item as Relationship).relation)
  )
}
