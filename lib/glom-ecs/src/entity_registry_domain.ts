import { assert_defined } from "./assert"
import { type Entity, get_lo, make_entity } from "./entity"

export type EntityRegistryDomain = {
  hi: number
  entity_id: number
  entity_count: number
  dense: number[]
  sparse: number[]
}

export function make_entity_registry_domain(hi: number): EntityRegistryDomain {
  return {
    hi,
    entity_id: 0,
    entity_count: 0,
    dense: [],
    sparse: [],
  }
}

export function add_domain_entity(
  domain: EntityRegistryDomain,
  entity: Entity,
) {
  const lo = get_lo(entity)
  if (domain.sparse[lo] !== undefined) {
    return
  }
  domain.dense[domain.entity_count] = entity
  domain.sparse[lo] = domain.entity_count
  domain.entity_count++
}

export function remove_domain_entity(
  domain: EntityRegistryDomain,
  entity: Entity,
) {
  const lo = get_lo(entity)
  const index = domain.sparse[lo]
  if (index === undefined) {
    return
  }
  const last_entity = domain.dense[domain.entity_count - 1]
  assert_defined(last_entity)
  domain.dense[index] = last_entity
  domain.sparse[get_lo(last_entity)] = index
  delete domain.sparse[lo]
  domain.entity_count--
}

export function alloc_domain_entity(domain: EntityRegistryDomain): Entity {
  const entity = make_entity(domain.entity_id++, domain.hi)
  add_domain_entity(domain, entity)
  return entity
}
