import {describe, expect, test} from "bun:test"
import {get_domain_id, get_local_id} from "./entity"
import {
  alloc_entity,
  make_entity_registry,
  remove_entity,
} from "./entity_registry"

describe("entity_registry", () => {
  test("make_entity_registry", () => {
    const domain_id = 10
    const registry = make_entity_registry(domain_id)
    expect(registry.domain_id).toBe(domain_id)
    expect(registry.domains).toEqual([])
  })

  test("alloc_entity", () => {
    const registry = make_entity_registry(5)
    const domain_id = 2
    const entity = alloc_entity(registry, domain_id)

    expect(get_domain_id(entity)).toBe(domain_id)
    expect(get_local_id(entity)).toBe(1)
    expect(registry.domains[domain_id]).toBeDefined()
    expect(registry.domains[domain_id]?.entity_count).toBe(1)
  })

  test("alloc_multiple_entities in same domain", () => {
    const registry = make_entity_registry(5)
    const domain_id = 1
    const e1 = alloc_entity(registry, domain_id)
    const e2 = alloc_entity(registry, domain_id)

    expect(get_domain_id(e1)).toBe(domain_id)
    expect(get_local_id(e1)).toBe(1)
    expect(get_domain_id(e2)).toBe(domain_id)
    expect(get_local_id(e2)).toBe(2)
    expect(registry.domains[domain_id]?.entity_count).toBe(2)
  })

  test("alloc_entities in different domains", () => {
    const registry = make_entity_registry(5)
    const e1 = alloc_entity(registry, 1)
    const e2 = alloc_entity(registry, 2)

    expect(get_domain_id(e1)).toBe(1)
    expect(get_domain_id(e2)).toBe(2)
    expect(registry.domains[1]?.entity_count).toBe(1)
    expect(registry.domains[2]?.entity_count).toBe(1)
  })

  test("remove_entity", () => {
    const registry = make_entity_registry(5)
    const domain_id = 1
    const e1 = alloc_entity(registry, domain_id)
    const e2 = alloc_entity(registry, domain_id)

    expect(registry.domains[domain_id]?.entity_count).toBe(2)

    remove_entity(registry, e1)
    expect(registry.domains[domain_id]?.entity_count).toBe(1)
    expect(registry.domains[domain_id]?.dense[0]).toBe(e2)
  })

  test("remove_last_entity", () => {
    const registry = make_entity_registry(5)
    const domain_id = 1
    const e1 = alloc_entity(registry, domain_id)

    expect(registry.domains[domain_id]?.entity_count).toBe(1)

    remove_entity(registry, e1)
    expect(registry.domains[domain_id]?.entity_count).toBe(0)
  })

  test("alloc after remove", () => {
    const registry = make_entity_registry(5)
    const domain_id = 1
    const e1 = alloc_entity(registry, domain_id)
    const e2 = alloc_entity(registry, domain_id)

    remove_entity(registry, e1)

    const e3 = alloc_entity(registry, domain_id)
    expect(e3).not.toBe(e2)
    expect(get_local_id(e3)).not.toBe(get_local_id(e2))
  })
})
