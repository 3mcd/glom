import {assert_defined} from "./assert"
import {type Entity, get_local_id, make_entity} from "./entity"

export type EntityRegistryDomain = {
  domain_id: number
  entity_id: number
  op_seq: number
  entity_count: number
  dense: number[]
  sparse: Map<number, number>
}

export function make_entity_registry_domain(
  domain_id: number,
): EntityRegistryDomain {
  return {
    domain_id,
    entity_id: 1,
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
  const local_id = get_local_id(entity)
  if (domain.sparse.has(local_id)) {
    return
  }
  domain.dense[domain.entity_count] = entity
  domain.sparse.set(local_id, domain.entity_count)
  domain.entity_count++
}

export function remove_domain_entity(
  domain: EntityRegistryDomain,
  entity: Entity,
) {
  const local_id = get_local_id(entity)
  const index = domain.sparse.get(local_id)
  if (index === undefined) {
    return
  }
  const last_entity = domain.dense[domain.entity_count - 1]
  assert_defined(last_entity)
  domain.dense[index] = last_entity
  domain.sparse.set(get_local_id(last_entity), index)
  domain.sparse.delete(local_id)
  domain.entity_count--
}

export function alloc_domain_entity(domain: EntityRegistryDomain): Entity {
  const entity = make_entity(domain.entity_id++, domain.domain_id)
  add_domain_entity(domain, entity)
  return entity
}
