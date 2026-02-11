import {describe, expect, test} from "bun:test"
import * as SparseMap from "./sparse_map"

describe("sparseMap", () => {
  test("set and get", () => {
    const map = SparseMap.create<string>()
    SparseMap.set(map, 10, "ten")
    SparseMap.set(map, 20, "twenty")

    expect(SparseMap.get(map, 10)).toBe("ten")
    expect(SparseMap.get(map, 20)).toBe("twenty")
    expect(SparseMap.get(map, 30)).toBeUndefined()
  })

  test("has", () => {
    const map = SparseMap.create<number>()
    SparseMap.set(map, 5, 500)
    expect(SparseMap.has(map, 5)).toBe(true)
    expect(SparseMap.has(map, 6)).toBe(false)
  })

  test("delete", () => {
    const map = SparseMap.create<string>()
    SparseMap.set(map, 1, "one")
    SparseMap.set(map, 2, "two")
    SparseMap.set(map, 3, "three")

    SparseMap.del(map, 2)
    expect(SparseMap.has(map, 2)).toBe(false)
    expect(SparseMap.get(map, 2)).toBeUndefined()
    expect(SparseMap.size(map)).toBe(2)

    expect(SparseMap.get(map, 1)).toBe("one")
    expect(SparseMap.get(map, 3)).toBe("three")
  })

  test("size", () => {
    const map = SparseMap.create<number>()
    expect(SparseMap.size(map)).toBe(0)
    SparseMap.set(map, 1, 1)
    SparseMap.set(map, 2, 2)
    expect(SparseMap.size(map)).toBe(2)
    SparseMap.del(map, 1)
    expect(SparseMap.size(map)).toBe(1)
  })

  test("clear", () => {
    const map = SparseMap.create<number>()
    SparseMap.set(map, 1, 1)
    SparseMap.set(map, 2, 2)
    SparseMap.clear(map)
    expect(SparseMap.size(map)).toBe(0)
    expect(SparseMap.has(map, 1)).toBe(false)
    expect(SparseMap.has(map, 2)).toBe(false)
  })

  test("toSparseArray", () => {
    const map = SparseMap.create<string>()
    SparseMap.set(map, 1, "one")
    SparseMap.set(map, 3, "three")
    const arr = SparseMap.toSparseArray(map)
    expect(arr[1]).toBe("one")
    expect(arr[3]).toBe("three")
    expect(arr[0]).toBeUndefined()
    expect(arr[2]).toBeUndefined()
  })

  test("forEach", () => {
    const map = SparseMap.create<number>()
    SparseMap.set(map, 1, 10)
    SparseMap.set(map, 2, 20)
    const results: [number, number][] = []
    SparseMap.forEach(map, (k, v) => results.push([k, v]))

    expect(results).toContainEqual([1, 10])
    expect(results).toContainEqual([2, 20])
    expect(results.length).toBe(2)
  })

  test("forEachValue", () => {
    const map = SparseMap.create<number>()
    SparseMap.set(map, 1, 10)
    SparseMap.set(map, 2, 20)
    const results: number[] = []
    SparseMap.forEachValue(map, (v) => results.push(v))
    expect(results).toContain(10)
    expect(results).toContain(20)
    expect(results.length).toBe(2)
  })

  test("clone", () => {
    const map = SparseMap.create<string>()
    SparseMap.set(map, 1, "one")
    const cloned = SparseMap.clone(map)
    expect(SparseMap.get(cloned, 1)).toBe("one")
    SparseMap.set(map, 1, "new")
    expect(SparseMap.get(cloned, 1)).toBe("one")
  })
})
