import {assert_defined} from "./assert"
import {type Entity, get_lo, make_entity} from "./entity"

export type EntityRegistryDomain = {
  hi: number
  entity_id: number
  op_seq: number
  entity_count: number
  dense: number[]
  sparse: Map<number, number>
}

export function make_entity_registry_domain(hi: number): EntityRegistryDomain {
  return {
    hi,
    entity_id: 1, // Start at 1 to reserve 0 for RESOURCE_ENTITY
    op_seq: 0,
    entity_count: 0,
    dense: [],
    sparse: new Map(),
  }
}

export function add_domain_entity(
  domain: EntityRegistryDomain,
  entity: Entity,
) {
  const lo = get_lo(entity)
  if (domain.sparse.has(lo)) {
    return
  }
  domain.dense[domain.entity_count] = entity
  domain.sparse.set(lo, domain.entity_count)
  domain.entity_count++
}

export function remove_domain_entity(
  domain: EntityRegistryDomain,
  entity: Entity,
) {
  const lo = get_lo(entity)
  const index = domain.sparse.get(lo)
  if (index === undefined) {
    return
  }
  const last_entity = domain.dense[domain.entity_count - 1]
  assert_defined(last_entity)
  domain.dense[index] = last_entity
  domain.sparse.set(get_lo(last_entity), index)
  domain.sparse.delete(lo)
  domain.entity_count--
}

export function alloc_domain_entity(domain: EntityRegistryDomain): Entity {
  const entity = make_entity(domain.entity_id++, domain.hi)
  add_domain_entity(domain, entity)
  return entity
}
