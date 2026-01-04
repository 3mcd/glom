import type {Entity} from "./entity"
import {
  entity_graph_get_entity_node,
  entity_graph_node_add_relation,
  entity_graph_node_remove_relation,
} from "./entity_graph"
import type {Relation} from "./relation"
import type {World} from "./world"

export type RelationSubject = {
  subject: Entity
  relation_id: number
}

export type RelationPair = {
  relation_id: number
  object: Entity
}

export type RelationRegistry = {
  readonly rel_to_virtual: Map<number, Map<number, number>>
  readonly virtual_to_rel: Map<number, RelationPair>
  readonly object_to_subjects: Map<number, Set<RelationSubject>>
}

export function make_relation_registry(): RelationRegistry {
  return {
    rel_to_virtual: new Map(),
    virtual_to_rel: new Map(),
    object_to_subjects: new Map(),
  }
}

export function get_or_create_virtual_id(
  world: World,
  relation: Relation,
  object: Entity,
): number {
  const registry = world.relations
  const relation_id = world.component_registry.get_id(relation)
  let objects = registry.rel_to_virtual.get(relation_id)
  if (!objects) {
    objects = new Map()
    registry.rel_to_virtual.set(relation_id, objects)
  }

  let virtual_id = objects.get(object)
  if (virtual_id === undefined) {
    virtual_id = world.component_registry.alloc_virtual_id()
    objects.set(object, virtual_id)
    registry.virtual_to_rel.set(virtual_id, {
      relation_id,
      object,
    })
  }

  return virtual_id
}

export function register_incoming_relation(
  world: World,
  subject: Entity,
  relation_id: number,
  object: Entity,
): void {
  let incoming = world.relations.object_to_subjects.get(object)
  if (!incoming) {
    incoming = new Set<RelationSubject>()
    world.relations.object_to_subjects.set(object, incoming)
  }
  incoming.add({subject, relation_id})

  const node = entity_graph_get_entity_node(world.entity_graph, object)
  if (node) {
    entity_graph_node_add_relation(node, relation_id, subject, object)
  }
}

export function unregister_incoming_relation(
  world: World,
  subject: Entity,
  relation_id: number,
  object: Entity,
): void {
  const registry = world.relations
  const incoming = registry.object_to_subjects.get(object)
  if (incoming) {
    for (const item of incoming) {
      if (item.subject === subject && item.relation_id === relation_id) {
        incoming.delete(item)
        break
      }
    }
    if (incoming.size === 0) {
      registry.object_to_subjects.delete(object)
    }
  }

  const node = entity_graph_get_entity_node(world.entity_graph, object)
  if (node) {
    entity_graph_node_remove_relation(node, relation_id, subject, object)
  }
}

export function get_virtual_id(
  registry: RelationRegistry,
  relation_id: number,
  object: number,
): number | undefined {
  return registry.rel_to_virtual.get(relation_id)?.get(object)
}
