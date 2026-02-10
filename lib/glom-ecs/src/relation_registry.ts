import type {Entity} from "./entity"
import {
  entityGraphNodeAddRelation,
  entityGraphNodeRemoveRelation,
} from "./entity_graph"
import type {Relation} from "./relation"
import {getEntityNode, type World} from "./world"

export type RelationSubject = {
  subject: Entity
  relationId: number
}

export type RelationPair = {
  relationId: number
  object: Entity
}

export type RelationRegistry = {
  readonly relToVirtual: Map<number, Map<number, number>>
  readonly virtualToRel: Map<number, RelationPair>
  readonly objectToSubjects: Map<number, Set<RelationSubject>>
}

export function makeRelationRegistry(): RelationRegistry {
  return {
    relToVirtual: new Map(),
    virtualToRel: new Map(),
    objectToSubjects: new Map(),
  }
}

export function getOrCreateVirtualId(
  world: World,
  relation: Relation,
  object: Entity,
): number {
  const relationId = world.componentRegistry.getId(relation)
  const objects = getOrCreateVirtualMap(world, relationId)

  let virtualId = objects.get(object)
  if (virtualId === undefined) {
    virtualId = world.componentRegistry.allocVirtualId()
    objects.set(object, virtualId)
    setRelationPair(world, virtualId, {relationId, object})
  }

  return virtualId
}

export function registerIncomingRelation(
  world: World,
  subject: Entity,
  relationId: number,
  object: Entity,
): void {
  const incoming = getOrCreateObjectSubjects(world, object as number)
  incoming.add({subject, relationId})

  const node = getEntityNode(world, object)
  if (node !== undefined) {
    entityGraphNodeAddRelation(node, relationId, subject, object)
  }
}

export function unregisterIncomingRelation(
  world: World,
  subject: Entity,
  relationId: number,
  object: Entity,
): void {
  const incoming = getObjectSubjects(world, object as number)
  if (incoming !== undefined) {
    for (const item of incoming) {
      if (item.subject === subject && item.relationId === relationId) {
        incoming.delete(item)
        break
      }
    }
    if (incoming.size === 0) {
      deleteObjectSubjects(world, object as number)
    }
  }

  const node = getEntityNode(world, object)
  if (node !== undefined) {
    entityGraphNodeRemoveRelation(node, relationId, subject, object)
  }
}

export function getVirtualId(
  world: World,
  relationId: number,
  object: number,
): number | undefined {
  return world.relations.relToVirtual.get(relationId)?.get(object)
}

/** Get the object→virtualId map for a given relation. */
export function getVirtualMap(
  world: World,
  relationId: number,
): Map<number, number> | undefined {
  return world.relations.relToVirtual.get(relationId)
}

/** Get or create the object→virtualId map for a given relation. */
export function getOrCreateVirtualMap(
  world: World,
  relationId: number,
): Map<number, number> {
  let map = world.relations.relToVirtual.get(relationId)
  if (map === undefined) {
    map = new Map()
    world.relations.relToVirtual.set(relationId, map)
  }
  return map
}

/** Look up the relation pair (relationId + object entity) for a virtual component ID. */
export function getRelationPair(
  world: World,
  virtualId: number,
): RelationPair | undefined {
  return world.relations.virtualToRel.get(virtualId)
}

/** Register a virtual component ID → relation pair mapping. */
export function setRelationPair(
  world: World,
  virtualId: number,
  pair: RelationPair,
): void {
  world.relations.virtualToRel.set(virtualId, pair)
}

/** Get the set of subjects that relate to a given object entity. */
export function getObjectSubjects(
  world: World,
  object: number,
): Set<RelationSubject> | undefined {
  return world.relations.objectToSubjects.get(object)
}

/** Get or create the set of subjects that relate to a given object entity. */
export function getOrCreateObjectSubjects(
  world: World,
  object: number,
): Set<RelationSubject> {
  let subjects = world.relations.objectToSubjects.get(object)
  if (subjects === undefined) {
    subjects = new Set()
    world.relations.objectToSubjects.set(object, subjects)
  }
  return subjects
}

/** Remove all incoming relation tracking for an object entity. */
export function deleteObjectSubjects(world: World, object: number): void {
  world.relations.objectToSubjects.delete(object)
}
