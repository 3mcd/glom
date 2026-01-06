import {describe, expect, test} from "bun:test"
import {
  makeSparseMap,
  sparseMapGet,
  sparseMapSet,
  sparseMapHas,
  sparseMapDelete,
  sparseMapSize,
  sparseMapClear,
  sparseMapToSparseArray,
  sparseMapForEach,
  sparseMapForEachValue,
  sparseMapClone,
} from "./sparse_map"

describe("sparseMap", () => {
  test("set and get", () => {
    const map = makeSparseMap<string>()
    sparseMapSet(map, 10, "ten")
    sparseMapSet(map, 20, "twenty")

    expect(sparseMapGet(map, 10)).toBe("ten")
    expect(sparseMapGet(map, 20)).toBe("twenty")
    expect(sparseMapGet(map, 30)).toBeUndefined()
  })

  test("has", () => {
    const map = makeSparseMap<number>()
    sparseMapSet(map, 5, 500)
    expect(sparseMapHas(map, 5)).toBe(true)
    expect(sparseMapHas(map, 6)).toBe(false)
  })

  test("delete", () => {
    const map = makeSparseMap<string>()
    sparseMapSet(map, 1, "one")
    sparseMapSet(map, 2, "two")
    sparseMapSet(map, 3, "three")

    sparseMapDelete(map, 2)
    expect(sparseMapHas(map, 2)).toBe(false)
    expect(sparseMapGet(map, 2)).toBeUndefined()
    expect(sparseMapSize(map)).toBe(2)

    expect(sparseMapGet(map, 1)).toBe("one")
    expect(sparseMapGet(map, 3)).toBe("three")
  })

  test("size", () => {
    const map = makeSparseMap<number>()
    expect(sparseMapSize(map)).toBe(0)
    sparseMapSet(map, 1, 1)
    sparseMapSet(map, 2, 2)
    expect(sparseMapSize(map)).toBe(2)
    sparseMapDelete(map, 1)
    expect(sparseMapSize(map)).toBe(1)
  })

  test("clear", () => {
    const map = makeSparseMap<number>()
    sparseMapSet(map, 1, 1)
    sparseMapSet(map, 2, 2)
    sparseMapClear(map)
    expect(sparseMapSize(map)).toBe(0)
    expect(sparseMapHas(map, 1)).toBe(false)
    expect(sparseMapHas(map, 2)).toBe(false)
  })

  test("toSparseArray", () => {
    const map = makeSparseMap<string>()
    sparseMapSet(map, 1, "one")
    sparseMapSet(map, 3, "three")
    const arr = sparseMapToSparseArray(map)
    expect(arr[1]).toBe("one")
    expect(arr[3]).toBe("three")
    expect(arr[0]).toBeUndefined()
    expect(arr[2]).toBeUndefined()
  })

  test("forEach", () => {
    const map = makeSparseMap<number>()
    sparseMapSet(map, 1, 10)
    sparseMapSet(map, 2, 20)
    const results: [number, number][] = []
    sparseMapForEach(map, (k, v) => results.push([k, v]))

    expect(results).toContainEqual([1, 10])
    expect(results).toContainEqual([2, 20])
    expect(results.length).toBe(2)
  })

  test("forEachValue", () => {
    const map = makeSparseMap<number>()
    sparseMapSet(map, 1, 10)
    sparseMapSet(map, 2, 20)
    const results: number[] = []
    sparseMapForEachValue(map, (v) => results.push(v))
    expect(results).toContain(10)
    expect(results).toContain(20)
    expect(results.length).toBe(2)
  })

  test("clone", () => {
    const map = makeSparseMap<string>()
    sparseMapSet(map, 1, "one")
    const cloned = sparseMapClone(map)
    expect(sparseMapGet(cloned, 1)).toBe("one")
    sparseMapSet(map, 1, "new")
    expect(sparseMapGet(cloned, 1)).toBe("one")
  })
})
