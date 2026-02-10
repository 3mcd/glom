import {describe, expect, test} from "bun:test"
import {defineComponent} from "./component"
import {makeComponentRegistry} from "./registry"
import {
  makeVec,
  makeVecSorted,
  vecDifference,
  vecHas,
  vecIntersection,
  vecIsSupersetOf,
  vecSum,
  vecXorHash,
} from "./vec"

describe("vec", () => {
  const c1 = defineComponent<number>("c1", undefined, 1)
  const c2 = defineComponent<number>("c2", undefined, 2)
  const c3 = defineComponent<number>("c3", undefined, 3)
  const registry = makeComponentRegistry([c1, c2, c3])
  const emptyVec = makeVecSorted([], registry)

  test("makeVec sorts components by id", () => {
    const vec = makeVec([c3, c1, c2], registry)
    expect(vec.elements).toEqual([c1, c2, c3])
    expect(vec.ids).toEqual([1, 2, 3])
  })

  test("makeVecSorted expects sorted components", () => {
    const vec = makeVecSorted([c1, c2, c3], registry)
    expect(vec.elements).toEqual([c1, c2, c3])
    expect(vec.ids).toEqual([1, 2, 3])
  })

  test("emptyVec is indeed empty", () => {
    expect(emptyVec.elements).toEqual([])
    expect(emptyVec.ids).toEqual([])
  })

  test("vecHas", () => {
    const vec = makeVec([c1, c2], registry)
    expect(vecHas(vec, c1, registry)).toBe(true)
    expect(vecHas(vec, c2, registry)).toBe(true)
    expect(vecHas(vec, c3, registry)).toBe(false)
  })

  test("vecIsSupersetOf", () => {
    const v12 = makeVec([c1, c2], registry)
    const v123 = makeVec([c1, c2, c3], registry)
    const v1 = makeVec([c1], registry)
    const v3 = makeVec([c3], registry)

    expect(vecIsSupersetOf(v123, v12)).toBe(true)
    expect(vecIsSupersetOf(v123, v1)).toBe(true)
    expect(vecIsSupersetOf(v123, emptyVec)).toBe(true)

    expect(vecIsSupersetOf(v12, v123)).toBe(false)
    expect(vecIsSupersetOf(v12, v3)).toBe(false)
    expect(vecIsSupersetOf(v12, v12)).toBe(true)
    expect(vecIsSupersetOf(emptyVec, v1)).toBe(false)
  })

  test("vecSum", () => {
    const v1 = makeVec([c1], registry)
    const v2 = makeVec([c2], registry)
    const v12 = vecSum(v1, v2, registry)

    expect(v12.ids).toEqual([1, 2])
    expect(vecSum(v1, v1, registry).ids).toEqual([1])
    expect(vecSum(v1, emptyVec, registry).ids).toEqual([1])

    const v12Cached = vecSum(v1, v2, registry)
    expect(v12Cached).toBe(v12)
  })

  test("vecDifference", () => {
    const v12 = makeVec([c1, c2], registry)
    const v23 = makeVec([c2, c3], registry)
    const diff = vecDifference(v12, v23, registry)

    expect(diff.ids).toEqual([1])
    expect(vecDifference(v12, v12, registry).ids).toEqual([])
    expect(vecDifference(v12, emptyVec, registry).ids).toEqual([1, 2])
  })

  test("vecIntersection", () => {
    const v12 = makeVec([c1, c2], registry)
    const v23 = makeVec([c2, c3], registry)
    const inter = vecIntersection(v12, v23, registry)

    expect(inter.ids).toEqual([2])
    expect(vecIntersection(v12, v12, registry).ids).toEqual([1, 2])
    expect(vecIntersection(v12, emptyVec, registry).ids).toEqual([])
  })

  test("vecXorHash", () => {
    const v1 = makeVec([c1], registry)
    const v2 = makeVec([c2], registry)

    const xor12 = vecXorHash(v1, v2)
    const xor12Rev = vecXorHash(v2, v1)

    expect(xor12).toBe(xor12Rev)
    expect(xor12).not.toBe(0)
    expect(vecXorHash(v1, v1)).toBe(0)
  })

  test("makeVecSorted with custom id map", () => {
    const vec = makeVecSorted([c1, c2, c3], registry)
    expect(vec.sparse.get(1)).toBe(0)
    expect(vec.sparse.get(2)).toBe(1)
    expect(vec.sparse.get(3)).toBe(2)
  })

  test("vecSum caching is symmetric", () => {
    const v1 = makeVec([c1], registry)
    const v2 = makeVec([c2], registry)
    const s12 = vecSum(v1, v2, registry)
    expect(v2.sums.get(v1)).toBe(s12)
  })
})
