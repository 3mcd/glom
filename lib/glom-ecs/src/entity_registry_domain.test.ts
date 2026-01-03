import { describe, expect, test } from "bun:test"
import { type Entity, get_hi, get_lo } from "./entity"
import {
  alloc_domain_entity,
  make_entity_registry_domain,
  remove_domain_entity,
} from "./entity_registry_domain"

describe("entity_registry_domain", () => {
  test("make_entity_registry_domain", () => {
    const domain = make_entity_registry_domain(5)
    expect(domain.hi).toBe(5)
    expect(domain.entity_count).toBe(0)
    expect(domain.dense).toEqual([])
    expect(domain.sparse.size).toBe(0)
  })

  test("alloc_entity", () => {
    const domain = make_entity_registry_domain(10)
    const entity = alloc_domain_entity(domain)

    expect(domain.entity_count).toBe(1)
    expect(domain.dense[0]).toBe(entity)
    expect(domain.sparse.get(get_lo(entity))).toBe(0)
    expect(get_hi(entity)).toBe(10)
    expect(get_lo(entity)).toBe(1)
  })

  test("add_entity and remove_entity", () => {
    const domain = make_entity_registry_domain(1)
    const e1 = alloc_domain_entity(domain)
    const e2 = alloc_domain_entity(domain)

    expect(domain.entity_count).toBe(2)
    expect(domain.dense).toContain(e1)
    expect(domain.dense).toContain(e2)

    remove_domain_entity(domain, e1)
    
    expect(domain.entity_count).toBe(1)
    expect(domain.dense[0]).toBe(e2)
    expect(domain.sparse.get(get_lo(e2))).toBe(0)
    expect(domain.sparse.get(get_lo(e1))).toBeUndefined()
  })

  test("remove non-existent entity", () => {
    const domain = make_entity_registry_domain(1)
    const e1 = alloc_domain_entity(domain)
    remove_domain_entity(domain, 999 as Entity)
    expect(domain.entity_count).toBe(1)
    expect(domain.dense[0]).toBe(e1)
  })
})
