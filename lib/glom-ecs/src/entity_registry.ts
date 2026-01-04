import {type Entity, get_domain_id} from "./entity"
import {
  alloc_domain_entity,
  type EntityRegistryDomain,
  make_entity_registry_domain,
  remove_domain_entity,
} from "./entity_registry_domain"

export type EntityRegistry = {
  domain_id: number
  domains: EntityRegistryDomain[]
}

export function make_entity_registry(domain_id: number): EntityRegistry {
  return {
    domain_id,
    domains: [],
  }
}

export function get_domain(
  registry: EntityRegistry,
  domain_id: number,
): EntityRegistryDomain {
  return (registry.domains[domain_id] ??= make_entity_registry_domain(domain_id))
}

export function alloc_entity(
  registry: EntityRegistry,
  domain_id: number,
): Entity {
  return alloc_domain_entity(get_domain(registry, domain_id))
}

export function remove_entity(registry: EntityRegistry, entity: Entity) {
  remove_domain_entity(get_domain(registry, get_domain_id(entity)), entity)
}

export function next_op_seq(
  registry: EntityRegistry,
  domain_id: number,
): number {
  return get_domain(registry, domain_id).op_seq++
}
