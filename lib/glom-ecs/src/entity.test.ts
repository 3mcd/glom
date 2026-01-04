import {describe, expect, test} from "bun:test"
import {get_domain_id, get_local_id, make_entity, RESOURCE_ENTITY} from "./entity"

describe("entity", () => {
  test("make_entity and getters", () => {
    const entity_id = 123
    const domain_id = 5
    const entity = make_entity(entity_id, domain_id)

    expect(get_local_id(entity)).toBe(entity_id)
    expect(get_domain_id(entity)).toBe(domain_id)
  })

  test("make_entity with max values", () => {
    const max_entity_id = (1 << 20) - 1
    const max_domain_id = (1 << (31 - 20)) - 1
    const entity = make_entity(max_entity_id, max_domain_id)

    expect(get_local_id(entity)).toBe(max_entity_id)
    expect(get_domain_id(entity)).toBe(max_domain_id)
  })

  test("RESOURCE_ENTITY is defined", () => {
    expect(RESOURCE_ENTITY).toBeDefined()
    expect(typeof RESOURCE_ENTITY).toBe("number")
  })

  describe("assertions", () => {
    test("make_entity id out of bounds", () => {
      expect(() => make_entity(-1, 0)).toThrow()
      expect(() => make_entity(1 << 20, 0)).toThrow()
    })

    test("make_entity domain_id out of bounds", () => {
      expect(() => make_entity(0, -1)).toThrow()
      expect(() => make_entity(0, 1 << 11)).toThrow()
    })

    test("get_local_id/get_domain_id out of bounds", () => {
      expect(() => get_local_id(-1)).toThrow()
      expect(() => get_local_id(2 ** 31)).toThrow()
      expect(() => get_domain_id(-1)).toThrow()
      expect(() => get_domain_id(2 ** 31)).toThrow()
    })
  })
})
