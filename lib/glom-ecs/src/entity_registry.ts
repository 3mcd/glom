import {type Entity, get_hi} from "./entity"
import {
  alloc_domain_entity,
  type EntityRegistryDomain,
  make_entity_registry_domain,
  remove_domain_entity,
} from "./entity_registry_domain"

export type EntityRegistry = {
  hi: number
  domains: EntityRegistryDomain[]
}

export function make_entity_registry(hi: number): EntityRegistry {
  return {
    hi,
    domains: [],
  }
}

export function get_domain(
  registry: EntityRegistry,
  hi: number,
): EntityRegistryDomain {
  return (registry.domains[hi] ??= make_entity_registry_domain(hi))
}

export function alloc_entity(registry: EntityRegistry, hi: number): Entity {
  return alloc_domain_entity(get_domain(registry, hi))
}

export function remove_entity(registry: EntityRegistry, entity: Entity) {
  remove_domain_entity(get_domain(registry, get_hi(entity)), entity)
}

export function next_op_seq(registry: EntityRegistry, hi: number): number {
  return get_domain(registry, hi).op_seq++
}
