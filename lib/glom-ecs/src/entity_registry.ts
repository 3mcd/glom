import {type Entity, getDomainId} from "./entity"
import {
  allocDomainEntity,
  type EntityRegistryDomain,
  makeEntityRegistryDomain,
  removeDomainEntity,
} from "./entity_registry_domain"

export type EntityRegistry = {
  domainId: number
  domains: EntityRegistryDomain[]
}

export function makeEntityRegistry(domainId: number): EntityRegistry {
  return {
    domainId,
    domains: [],
  }
}

export function getDomain(
  registry: EntityRegistry,
  domainId: number,
): EntityRegistryDomain {
  return (registry.domains[domainId] ??= makeEntityRegistryDomain(domainId))
}

export function allocEntity(
  registry: EntityRegistry,
  domainId: number,
): Entity {
  return allocDomainEntity(getDomain(registry, domainId))
}

export function removeEntity(registry: EntityRegistry, entity: Entity) {
  removeDomainEntity(getDomain(registry, getDomainId(entity)), entity)
}

export function nextOpSeq(
  registry: EntityRegistry,
  domainId: number,
): number {
  return getDomain(registry, domainId).opSeq++
}
