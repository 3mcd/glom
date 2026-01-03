import { type Component, define_tag } from "./component"
import type { Entity } from "./entity"
import type { Relation } from "./relation"
import type { World } from "./world"

export type RelationRegistry = {
  readonly relation_to_virtual: Map<number, Map<number, number>>
  readonly virtual_to_relation: Map<number, { rel_id: number; target: number }>
  readonly target_to_incoming: Map<
    number,
    Set<{ source: number; rel_id: number }>
  >
  readonly component_cache: Map<number, Component<void>>
  next_virtual_id: number
}

export function make_relation_registry(): RelationRegistry {
  return {
    relation_to_virtual: new Map(),
    virtual_to_relation: new Map(),
    target_to_incoming: new Map(),
    component_cache: new Map(),
    next_virtual_id: 1000000,
  }
}

export function get_or_create_virtual_id(
  world: World,
  relation: Relation,
  target: Entity,
): number {
  const registry = world.relations
  let targets = registry.relation_to_virtual.get(relation.id)
  if (!targets) {
    targets = new Map()
    registry.relation_to_virtual.set(relation.id, targets)
  }

  let virtual_id = targets.get(target)
  if (virtual_id === undefined) {
    virtual_id = registry.next_virtual_id++
    targets.set(target, virtual_id)
    registry.virtual_to_relation.set(virtual_id, {
      rel_id: relation.id,
      target,
    })
  }

  return virtual_id
}

export function register_incoming_relation(
  world: World,
  source: Entity,
  rel_id: number,
  target: Entity,
): void {
  const registry = world.relations
  let incoming = registry.target_to_incoming.get(target)
  if (!incoming) {
    incoming = new Set()
    registry.target_to_incoming.set(target, incoming)
  }
  incoming.add({ source, rel_id })
}

export function unregister_incoming_relation(
  world: World,
  source: Entity,
  rel_id: number,
  target: Entity,
): void {
  const registry = world.relations
  const incoming = registry.target_to_incoming.get(target)
  if (incoming) {
    for (const item of incoming) {
      if (item.source === source && item.rel_id === rel_id) {
        incoming.delete(item)
        break
      }
    }
    if (incoming.size === 0) {
      registry.target_to_incoming.delete(target)
    }
  }
}

export function get_virtual_id(
  registry: RelationRegistry,
  rel_id: number,
  target: number,
): number | undefined {
  return registry.relation_to_virtual.get(rel_id)?.get(target)
}

export function get_virtual_component(
  registry: RelationRegistry,
  id: number,
): Component<void> {
  let comp = registry.component_cache.get(id)
  if (!comp) {
    comp = define_tag(id)
    registry.component_cache.set(id, comp)
  }
  return comp
}
