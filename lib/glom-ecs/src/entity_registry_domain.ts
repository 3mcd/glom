import {assertDefined} from "./assert"
import * as Entity from "./entity"

export type EntityRegistryDomain = {
  domainId: number
  entityId: number
  opSeq: number
  entityCount: number
  dense: number[]
  sparse: Map<number, number>
  freeIds: number[]
}

export function makeEntityRegistryDomain(
  domainId: number,
): EntityRegistryDomain {
  return {
    domainId,
    entityId: 1,
    opSeq: 0,
    entityCount: 0,
    dense: [],
    sparse: new Map(),
    freeIds: [],
  }
}

export function addDomainEntity(domain: EntityRegistryDomain, entity: Entity.Entity) {
  const localId = Entity.localId(entity)
  if (domain.sparse.has(localId)) {
    return
  }
  domain.dense[domain.entityCount] = entity
  domain.sparse.set(localId, domain.entityCount)
  domain.entityCount++
}

export function removeDomainEntity(
  domain: EntityRegistryDomain,
  entity: Entity.Entity,
) {
  const localId = Entity.localId(entity)
  const index = domain.sparse.get(localId)
  if (index === undefined) {
    return
  }
  const lastEntity = domain.dense[domain.entityCount - 1]
  assertDefined(lastEntity)
  domain.dense[index] = lastEntity
  domain.sparse.set(Entity.localId(lastEntity), index)
  domain.sparse.delete(localId)
  domain.entityCount--
  domain.freeIds.push(localId)
}

export function allocDomainEntity(domain: EntityRegistryDomain): Entity.Entity {
  const localId =
    domain.freeIds.length > 0
      ? (domain.freeIds.pop() as number)
      : domain.entityId++
  const entity = Entity.make(localId, domain.domainId)
  addDomainEntity(domain, entity)
  return entity
}
