import {describe, expect, test} from "bun:test"
import {get_hi, get_lo} from "./entity"
import {
  alloc_entity,
  make_entity_registry,
  remove_entity,
} from "./entity_registry"

describe("entity_registry", () => {
  test("make_entity_registry", () => {
    const hi = 10
    const registry = make_entity_registry(hi)
    expect(registry.hi).toBe(hi)
    expect(registry.domains).toEqual([])
  })

  test("alloc_entity", () => {
    const registry = make_entity_registry(5)
    const hi = 2
    const entity = alloc_entity(registry, hi)

    expect(get_hi(entity)).toBe(hi)
    expect(get_lo(entity)).toBe(1)
    expect(registry.domains[hi]).toBeDefined()
    expect(registry.domains[hi]?.entity_count).toBe(1)
  })

  test("alloc_multiple_entities in same domain", () => {
    const registry = make_entity_registry(5)
    const hi = 1
    const e1 = alloc_entity(registry, hi)
    const e2 = alloc_entity(registry, hi)

    expect(get_hi(e1)).toBe(hi)
    expect(get_lo(e1)).toBe(1)
    expect(get_hi(e2)).toBe(hi)
    expect(get_lo(e2)).toBe(2)
    expect(registry.domains[hi]?.entity_count).toBe(2)
  })

  test("alloc_entities in different domains", () => {
    const registry = make_entity_registry(5)
    const e1 = alloc_entity(registry, 1)
    const e2 = alloc_entity(registry, 2)

    expect(get_hi(e1)).toBe(1)
    expect(get_hi(e2)).toBe(2)
    expect(registry.domains[1]?.entity_count).toBe(1)
    expect(registry.domains[2]?.entity_count).toBe(1)
  })

  test("remove_entity", () => {
    const registry = make_entity_registry(5)
    const hi = 1
    const e1 = alloc_entity(registry, hi)
    const e2 = alloc_entity(registry, hi)

    expect(registry.domains[hi]?.entity_count).toBe(2)

    remove_entity(registry, e1)
    expect(registry.domains[hi]?.entity_count).toBe(1)
    expect(registry.domains[hi]?.dense[0]).toBe(e2)
  })

  test("remove_last_entity", () => {
    const registry = make_entity_registry(5)
    const hi = 1
    const e1 = alloc_entity(registry, hi)

    expect(registry.domains[hi]?.entity_count).toBe(1)

    remove_entity(registry, e1)
    expect(registry.domains[hi]?.entity_count).toBe(0)
  })

  test("alloc after remove", () => {
    const registry = make_entity_registry(5)
    const hi = 1
    const e1 = alloc_entity(registry, hi)
    const e2 = alloc_entity(registry, hi)

    remove_entity(registry, e1)
    // Now only e2 (ID 1) is left. entity_count is 1.
    // Next alloc might try to use ID 1 again if it just uses entity_count.

    const e3 = alloc_entity(registry, hi)
    expect(e3).not.toBe(e2)
    expect(get_lo(e3)).not.toBe(get_lo(e2))
  })
})
