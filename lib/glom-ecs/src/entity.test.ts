import {describe, expect, test} from "bun:test"
import {get_hi, get_lo, make_entity, RESOURCE_ENTITY} from "./entity"

describe("entity", () => {
  test("make_entity and getters", () => {
    const id = 123
    const hi = 5
    const entity = make_entity(id, hi)

    expect(get_lo(entity)).toBe(id)
    expect(get_hi(entity)).toBe(hi)
  })

  test("make_entity with max values", () => {
    const max_id = (1 << 20) - 1
    const max_hi = (1 << (31 - 20)) - 1
    const entity = make_entity(max_id, max_hi)

    expect(get_lo(entity)).toBe(max_id)
    expect(get_hi(entity)).toBe(max_hi)
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

    test("make_entity hi out of bounds", () => {
      expect(() => make_entity(0, -1)).toThrow()
      expect(() => make_entity(0, 1 << 11)).toThrow()
    })

    test("get_lo/get_hi out of bounds", () => {
      expect(() => get_lo(-1)).toThrow()
      expect(() => get_lo(2 ** 31)).toThrow()
      expect(() => get_hi(-1)).toThrow()
      expect(() => get_hi(2 ** 31)).toThrow()
    })
  })
})
