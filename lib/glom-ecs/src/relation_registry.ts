import type {Entity} from "./entity"
import {
  entityGraphGetEntityNode,
  entityGraphNodeAddRelation,
  entityGraphNodeRemoveRelation,
} from "./entity_graph"
import type {Relation} from "./relation"
import type {World} from "./world"

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
  const registry = world.relations
  const relationId = world.componentRegistry.getId(relation)
  let objects = registry.relToVirtual.get(relationId)
  if (!objects) {
    objects = new Map()
    registry.relToVirtual.set(relationId, objects)
  }

  let virtualId = objects.get(object)
  if (virtualId === undefined) {
    virtualId = world.componentRegistry.allocVirtualId()
    objects.set(object, virtualId)
    registry.virtualToRel.set(virtualId, {
      relationId,
      object,
    })
  }

  return virtualId
}

export function registerIncomingRelation(
  world: World,
  subject: Entity,
  relationId: number,
  object: Entity,
): void {
  let incoming = world.relations.objectToSubjects.get(object)
  if (!incoming) {
    incoming = new Set<RelationSubject>()
    world.relations.objectToSubjects.set(object, incoming)
  }
  incoming.add({subject, relationId})

  const node = entityGraphGetEntityNode(world.entityGraph, object)
  if (node) {
    entityGraphNodeAddRelation(node, relationId, subject, object)
  }
}

export function unregisterIncomingRelation(
  world: World,
  subject: Entity,
  relationId: number,
  object: Entity,
): void {
  const registry = world.relations
  const incoming = registry.objectToSubjects.get(object)
  if (incoming) {
    for (const item of incoming) {
      if (item.subject === subject && item.relationId === relationId) {
        incoming.delete(item)
        break
      }
    }
    if (incoming.size === 0) {
      registry.objectToSubjects.delete(object)
    }
  }

  const node = entityGraphGetEntityNode(world.entityGraph, object)
  if (node) {
    entityGraphNodeRemoveRelation(node, relationId, subject, object)
  }
}

export function getVirtualId(
  registry: RelationRegistry,
  relationId: number,
  object: number,
): number | undefined {
  return registry.relToVirtual.get(relationId)?.get(object)
}
