import {describe, expect, test} from "bun:test"
import {getDomainId, getLocalId} from "./entity"
import {
  allocEntity,
  makeEntityRegistry,
  removeEntity,
} from "./entity_registry"

describe("entityRegistry", () => {
  test("makeEntityRegistry", () => {
    const domainId = 10
    const registry = makeEntityRegistry(domainId)
    expect(registry.domainId).toBe(domainId)
    expect(registry.domains).toEqual([])
  })

  test("allocEntity", () => {
    const registry = makeEntityRegistry(5)
    const domainId = 2
    const entity = allocEntity(registry, domainId)

    expect(getDomainId(entity)).toBe(domainId)
    expect(getLocalId(entity)).toBe(1)
    expect(registry.domains[domainId]).toBeDefined()
    expect(registry.domains[domainId]?.entityCount).toBe(1)
  })

  test("allocMultipleEntities in same domain", () => {
    const registry = makeEntityRegistry(5)
    const domainId = 1
    const e1 = allocEntity(registry, domainId)
    const e2 = allocEntity(registry, domainId)

    expect(getDomainId(e1)).toBe(domainId)
    expect(getLocalId(e1)).toBe(1)
    expect(getDomainId(e2)).toBe(domainId)
    expect(getLocalId(e2)).toBe(2)
    expect(registry.domains[domainId]?.entityCount).toBe(2)
  })

  test("allocEntities in different domains", () => {
    const registry = makeEntityRegistry(5)
    const e1 = allocEntity(registry, 1)
    const e2 = allocEntity(registry, 2)

    expect(getDomainId(e1)).toBe(1)
    expect(getDomainId(e2)).toBe(2)
    expect(registry.domains[1]?.entityCount).toBe(1)
    expect(registry.domains[2]?.entityCount).toBe(1)
  })

  test("removeEntity", () => {
    const registry = makeEntityRegistry(5)
    const domainId = 1
    const e1 = allocEntity(registry, domainId)
    const e2 = allocEntity(registry, domainId)

    expect(registry.domains[domainId]?.entityCount).toBe(2)

    removeEntity(registry, e1)
    expect(registry.domains[domainId]?.entityCount).toBe(1)
    expect(registry.domains[domainId]?.dense[0]).toBe(e2)
  })

  test("removeLastEntity", () => {
    const registry = makeEntityRegistry(5)
    const domainId = 1
    const e1 = allocEntity(registry, domainId)

    expect(registry.domains[domainId]?.entityCount).toBe(1)

    removeEntity(registry, e1)
    expect(registry.domains[domainId]?.entityCount).toBe(0)
  })

  test("alloc after remove", () => {
    const registry = makeEntityRegistry(5)
    const domainId = 1
    const e1 = allocEntity(registry, domainId)
    const e2 = allocEntity(registry, domainId)

    removeEntity(registry, e1)

    const e3 = allocEntity(registry, domainId)
    expect(e3).not.toBe(e2)
    expect(getLocalId(e3)).not.toBe(getLocalId(e2))
  })
})
