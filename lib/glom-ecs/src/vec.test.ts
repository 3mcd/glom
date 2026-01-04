import {describe, expect, test} from "bun:test"
import {define_component} from "./component"
import {make_component_registry} from "./registry"
import {
  make_vec,
  make_vec_sorted,
  vec_difference,
  vec_has,
  vec_intersection,
  vec_is_superset_of,
  vec_sum,
  vec_xor_hash,
} from "./vec"

describe("vec", () => {
  const c1 = define_component<number>(undefined, 1)
  const c2 = define_component<number>(undefined, 2)
  const c3 = define_component<number>(undefined, 3)
  const registry = make_component_registry({}, [c1, c2, c3])
  const empty_vec = make_vec_sorted([], registry)

  test("make_vec sorts components by id", () => {
    const vec = make_vec([c3, c1, c2], registry)
    expect(vec.elements).toEqual([c1, c2, c3])
    expect(vec.ids).toEqual([1, 2, 3])
  })

  test("make_vec_sorted expects sorted components", () => {
    const vec = make_vec_sorted([c1, c2, c3], registry)
    expect(vec.elements).toEqual([c1, c2, c3])
    expect(vec.ids).toEqual([1, 2, 3])
  })

  test("empty_vec is indeed empty", () => {
    expect(empty_vec.elements).toEqual([])
    expect(empty_vec.ids).toEqual([])
  })

  test("vec_has", () => {
    const vec = make_vec([c1, c2], registry)
    expect(vec_has(vec, c1, registry)).toBe(true)
    expect(vec_has(vec, c2, registry)).toBe(true)
    expect(vec_has(vec, c3, registry)).toBe(false)
  })

  test("vec_is_superset_of", () => {
    const v12 = make_vec([c1, c2], registry)
    const v123 = make_vec([c1, c2, c3], registry)
    const v1 = make_vec([c1], registry)
    const v3 = make_vec([c3], registry)

    expect(vec_is_superset_of(v123, v12)).toBe(true)
    expect(vec_is_superset_of(v123, v1)).toBe(true)
    expect(vec_is_superset_of(v123, empty_vec)).toBe(true)

    expect(vec_is_superset_of(v12, v123)).toBe(false)
    expect(vec_is_superset_of(v12, v3)).toBe(false)
    expect(vec_is_superset_of(v12, v12)).toBe(true)
    expect(vec_is_superset_of(empty_vec, v1)).toBe(false)
  })

  test("vec_sum", () => {
    const v1 = make_vec([c1], registry)
    const v2 = make_vec([c2], registry)
    const v12 = vec_sum(v1, v2, registry)

    expect(v12.ids).toEqual([1, 2])
    expect(vec_sum(v1, v1, registry).ids).toEqual([1])
    expect(vec_sum(v1, empty_vec, registry).ids).toEqual([1])

    // Test caching
    const v12_cached = vec_sum(v1, v2, registry)
    expect(v12_cached).toBe(v12)
  })

  test("vec_difference", () => {
    const v12 = make_vec([c1, c2], registry)
    const v23 = make_vec([c2, c3], registry)
    const diff = vec_difference(v12, v23, registry)

    expect(diff.ids).toEqual([1])
    expect(vec_difference(v12, v12, registry).ids).toEqual([])
    expect(vec_difference(v12, empty_vec, registry).ids).toEqual([1, 2])
  })

  test("vec_intersection", () => {
    const v12 = make_vec([c1, c2], registry)
    const v23 = make_vec([c2, c3], registry)
    const inter = vec_intersection(v12, v23, registry)

    expect(inter.ids).toEqual([2])
    expect(vec_intersection(v12, v12, registry).ids).toEqual([1, 2])
    expect(vec_intersection(v12, empty_vec, registry).ids).toEqual([])
  })

  test("vec_xor_hash", () => {
    const v1 = make_vec([c1], registry)
    const v2 = make_vec([c2], registry)

    const xor12 = vec_xor_hash(v1, v2)
    const xor12_rev = vec_xor_hash(v2, v1)

    expect(xor12).toBe(xor12_rev)
    expect(xor12).not.toBe(0)
    expect(vec_xor_hash(v1, v1)).toBe(0)
  })

  test("make_vec_sorted with custom id map", () => {
    const vec = make_vec_sorted([c1, c2, c3], registry)
    expect(vec.sparse.get(1)).toBe(0)
    expect(vec.sparse.get(2)).toBe(1)
    expect(vec.sparse.get(3)).toBe(2)
  })

  test("vec_sum caching is symmetric", () => {
    const v1 = make_vec([c1], registry)
    const v2 = make_vec([c2], registry)
    const s12 = vec_sum(v1, v2, registry)
    expect(v2.sums.get(v1)).toBe(s12)
  })
})
