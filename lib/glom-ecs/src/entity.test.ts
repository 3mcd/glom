import {describe, expect, test} from "bun:test"
import * as Entity from "./entity"
import {RESOURCE_ENTITY} from "./entity"

describe("entity", () => {
  test("create and getters", () => {
    const entityId = 123
    const domainId = 5
    const entity = Entity.make(entityId, domainId)

    expect(Entity.localId(entity)).toBe(entityId)
    expect(Entity.domainId(entity)).toBe(domainId)
  })

  test("create with max values", () => {
    const maxEntityId = (1 << 20) - 1
    const maxDomainId = (1 << (31 - 20)) - 1
    const entity = Entity.make(maxEntityId, maxDomainId)

    expect(Entity.localId(entity)).toBe(maxEntityId)
    expect(Entity.domainId(entity)).toBe(maxDomainId)
  })

  test("RESOURCE_ENTITY is defined", () => {
    expect(RESOURCE_ENTITY).toBeDefined()
    expect(typeof RESOURCE_ENTITY).toBe("number")
  })

  describe("assertions", () => {
    test("create id out of bounds", () => {
      expect(() => Entity.make(-1, 0)).toThrow()
      expect(() => Entity.make(1 << 20, 0)).toThrow()
    })

    test("create domainId out of bounds", () => {
      expect(() => Entity.make(0, -1)).toThrow()
      expect(() => Entity.make(0, 1 << 11)).toThrow()
    })

    test("localId/domainId out of bounds", () => {
      expect(() => Entity.localId(-1)).toThrow()
      expect(() => Entity.localId(2 ** 31)).toThrow()
      expect(() => Entity.domainId(-1)).toThrow()
      expect(() => Entity.domainId(2 ** 31)).toThrow()
    })
  })
})
