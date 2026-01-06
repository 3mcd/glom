import {describe, expect, test} from "bun:test"
import {type Entity, getDomainId, getLocalId} from "./entity"
import {
  allocDomainEntity,
  makeEntityRegistryDomain,
  removeDomainEntity,
} from "./entity_registry_domain"

describe("entityRegistryDomain", () => {
  test("makeEntityRegistryDomain", () => {
    const domain = makeEntityRegistryDomain(5)
    expect(domain.domainId).toBe(5)
    expect(domain.entityCount).toBe(0)
    expect(domain.dense).toEqual([])
    expect(domain.sparse.size).toBe(0)
  })

  test("allocEntity", () => {
    const domain = makeEntityRegistryDomain(10)
    const entity = allocDomainEntity(domain)

    expect(domain.entityCount).toBe(1)
    expect(domain.dense[0]).toBe(entity)
    expect(domain.sparse.get(getLocalId(entity))).toBe(0)
    expect(getDomainId(entity)).toBe(10)
    expect(getLocalId(entity)).toBe(1)
  })

  test("addEntity and removeEntity", () => {
    const domain = makeEntityRegistryDomain(1)
    const e1 = allocDomainEntity(domain)
    const e2 = allocDomainEntity(domain)

    expect(domain.entityCount).toBe(2)
    expect(domain.dense).toContain(e1)
    expect(domain.dense).toContain(e2)

    removeDomainEntity(domain, e1)

    expect(domain.entityCount).toBe(1)
    expect(domain.dense[0]).toBe(e2)
    expect(domain.sparse.get(getLocalId(e2))).toBe(0)
    expect(domain.sparse.get(getLocalId(e1))).toBeUndefined()
  })

  test("remove non-existent entity", () => {
    const domain = makeEntityRegistryDomain(1)
    const e1 = allocDomainEntity(domain)
    removeDomainEntity(domain, 999 as Entity)
    expect(domain.entityCount).toBe(1)
    expect(domain.dense[0]).toBe(e1)
  })
})
