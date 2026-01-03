import type { Component, ComponentLike } from "./component"
import type { Entity } from "./entity"

export type Relationship = Component<void> & {
  (target: Entity): RelationshipInstance
  __relationship_brand: true
}

export type RelationshipInstance = ComponentLike & {
  relationship: Relationship
  target: Entity
}

export function define_relationship(id: number): Relationship {
  const rel = ((target: Entity): RelationshipInstance => {
    return {
      relationship: rel as Relationship,
      target,
      __component_brand: true,
    } as RelationshipInstance
  }) as any

  rel.id = id
  rel.is_tag = true
  rel.__component_brand = true
  rel.__relationship_brand = true

  return rel as Relationship
}

export function is_relationship(component: any): component is Relationship {
  return !!component?.__relationship_brand
}

export function is_relationship_instance(
  component: any,
): component is RelationshipInstance {
  return !!component?.relationship && is_relationship(component.relationship)
}

