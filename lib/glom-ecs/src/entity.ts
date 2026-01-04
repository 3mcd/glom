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

export function assert_valid(entity: number) {
  assert(entity >= 0)
  assert(entity <= EXTENT)
}

export function assert_valid_id(entity_id: number) {
  assert(entity_id >= 0)
  assert(entity_id <= LO)
}

export function assert_valid_domain_id(domain_id: number) {
  assert(domain_id >= 0)
  assert(domain_id <= HI)
}

export function get_local_id(entity: number) {
  assert_valid(entity)
  return entity & LO
}

export function get_domain_id(entity: number) {
  assert_valid(entity)
  return entity >> LO_EXTENT
}

export function make_entity(entity_id: number, domain_id: number) {
  assert_valid_id(entity_id)
  assert_valid_domain_id(domain_id)
  return (((domain_id & HI) << LO_EXTENT) | entity_id) as Entity
}
