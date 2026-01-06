import {describe, expect, test} from "bun:test"
import {getDomainId, getLocalId, makeEntity, RESOURCE_ENTITY} from "./entity"

describe("entity", () => {
  test("makeEntity and getters", () => {
    const entityId = 123
    const domainId = 5
    const entity = makeEntity(entityId, domainId)

    expect(getLocalId(entity)).toBe(entityId)
    expect(getDomainId(entity)).toBe(domainId)
  })

  test("makeEntity with max values", () => {
    const maxEntityId = (1 << 20) - 1
    const maxDomainId = (1 << (31 - 20)) - 1
    const entity = makeEntity(maxEntityId, maxDomainId)

    expect(getLocalId(entity)).toBe(maxEntityId)
    expect(getDomainId(entity)).toBe(maxDomainId)
  })

  test("RESOURCE_ENTITY is defined", () => {
    expect(RESOURCE_ENTITY).toBeDefined()
    expect(typeof RESOURCE_ENTITY).toBe("number")
  })

  describe("assertions", () => {
    test("makeEntity id out of bounds", () => {
      expect(() => makeEntity(-1, 0)).toThrow()
      expect(() => makeEntity(1 << 20, 0)).toThrow()
    })

    test("makeEntity domainId out of bounds", () => {
      expect(() => makeEntity(0, -1)).toThrow()
      expect(() => makeEntity(0, 1 << 11)).toThrow()
    })

    test("getLocalId/getDomainId out of bounds", () => {
      expect(() => getLocalId(-1)).toThrow()
      expect(() => getLocalId(2 ** 31)).toThrow()
      expect(() => getDomainId(-1)).toThrow()
      expect(() => getDomainId(2 ** 31)).toThrow()
    })
  })
})
