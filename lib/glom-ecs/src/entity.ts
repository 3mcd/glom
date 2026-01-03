import { assert } from "./assert"

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

export const Entity = { entity: true } as const
export const ENTITY = Entity

export function assert_valid(entity: number) {
  assert(entity >= 0)
  assert(entity <= EXTENT)
}

export function assert_valid_id(id: number) {
  assert(id >= 0)
  assert(id <= LO)
}

export function assert_valid_hi(hi: number) {
  assert(hi >= 0)
  assert(hi <= HI)
}

export function get_lo(entity: number) {
  assert_valid(entity)
  return entity & LO
}

export function get_hi(entity: number) {
  assert_valid(entity)
  return entity >> LO_EXTENT
}

export function make_entity(id: number, hi: number) {
  assert_valid_id(id)
  assert_valid_hi(hi)
  return (((hi & HI) << LO_EXTENT) | id) as Entity
}
