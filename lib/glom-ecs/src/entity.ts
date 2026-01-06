import {assert} from "./assert"

type EntityBrand = {
  __glom_ecs_entity: never
}

export type Entity = number & EntityBrand

const LO_EXTENT = 20
const LO = (1 << LO_EXTENT) - 1
const HI_EXTENT = 31 - LO_EXTENT
const HI = (1 << HI_EXTENT) - 1
const EXTENT = 2 ** 31 - 1

export const RESOURCE_ENTITY = EXTENT as Entity

export const Entity = {entity: true} as const

export function assertValid(entity: number) {
  assert(entity >= 0)
  assert(entity <= EXTENT)
}

export function assertValidId(entityId: number) {
  assert(entityId >= 0)
  assert(entityId <= LO)
}

export function assertValidDomainId(domainId: number) {
  assert(domainId >= 0)
  assert(domainId <= HI)
}

export function getLocalId(entity: number) {
  assertValid(entity)
  return entity & LO
}

export function getDomainId(entity: number) {
  assertValid(entity)
  return entity >> LO_EXTENT
}

export function makeEntity(entityId: number, domainId: number) {
  assertValidId(entityId)
  assertValidDomainId(domainId)
  return (((domainId & HI) << LO_EXTENT) | entityId) as Entity
}
