import {describe, expect, test} from "bun:test"
import {
  make_sparse_map,
  sparse_map_get,
  sparse_map_set,
  sparse_map_has,
  sparse_map_delete,
  sparse_map_size,
  sparse_map_clear,
  sparse_map_to_sparse_array,
  sparse_map_for_each,
  sparse_map_for_each_value,
  sparse_map_clone,
} from "./sparse_map"

describe("sparse_map", () => {
  test("set and get", () => {
    const map = make_sparse_map<string>()
    sparse_map_set(map, 10, "ten")
    sparse_map_set(map, 20, "twenty")

    expect(sparse_map_get(map, 10)).toBe("ten")
    expect(sparse_map_get(map, 20)).toBe("twenty")
    expect(sparse_map_get(map, 30)).toBeUndefined()
  })

  test("has", () => {
    const map = make_sparse_map<number>()
    sparse_map_set(map, 5, 500)
    expect(sparse_map_has(map, 5)).toBe(true)
    expect(sparse_map_has(map, 6)).toBe(false)
  })

  test("delete", () => {
    const map = make_sparse_map<string>()
    sparse_map_set(map, 1, "one")
    sparse_map_set(map, 2, "two")
    sparse_map_set(map, 3, "three")

    sparse_map_delete(map, 2)
    expect(sparse_map_has(map, 2)).toBe(false)
    expect(sparse_map_get(map, 2)).toBeUndefined()
    expect(sparse_map_size(map)).toBe(2)

    // Check if swap-and-pop worked correctly
    expect(sparse_map_get(map, 1)).toBe("one")
    expect(sparse_map_get(map, 3)).toBe("three")
  })

  test("size", () => {
    const map = make_sparse_map<number>()
    expect(sparse_map_size(map)).toBe(0)
    sparse_map_set(map, 1, 1)
    sparse_map_set(map, 2, 2)
    expect(sparse_map_size(map)).toBe(2)
    sparse_map_delete(map, 1)
    expect(sparse_map_size(map)).toBe(1)
  })

  test("clear", () => {
    const map = make_sparse_map<number>()
    sparse_map_set(map, 1, 1)
    sparse_map_set(map, 2, 2)
    sparse_map_clear(map)
    expect(sparse_map_size(map)).toBe(0)
    expect(sparse_map_has(map, 1)).toBe(false)
    expect(sparse_map_has(map, 2)).toBe(false)
  })

  test("to_sparse_array", () => {
    const map = make_sparse_map<string>()
    sparse_map_set(map, 1, "one")
    sparse_map_set(map, 3, "three")
    const arr = sparse_map_to_sparse_array(map)
    expect(arr[1]).toBe("one")
    expect(arr[3]).toBe("three")
    expect(arr[0]).toBeUndefined()
    expect(arr[2]).toBeUndefined()
  })

  test("for_each", () => {
    const map = make_sparse_map<number>()
    sparse_map_set(map, 1, 10)
    sparse_map_set(map, 2, 20)
    const results: [number, number][] = []
    sparse_map_for_each(map, (k, v) => results.push([k, v]))
    // for_each currently iterates backwards
    expect(results).toContainEqual([1, 10])
    expect(results).toContainEqual([2, 20])
    expect(results.length).toBe(2)
  })

  test("for_each_value", () => {
    const map = make_sparse_map<number>()
    sparse_map_set(map, 1, 10)
    sparse_map_set(map, 2, 20)
    const results: number[] = []
    sparse_map_for_each_value(map, (v) => results.push(v))
    expect(results).toContain(10)
    expect(results).toContain(20)
    expect(results.length).toBe(2)
  })

  test("clone", () => {
    const map = make_sparse_map<string>()
    sparse_map_set(map, 1, "one")
    const cloned = sparse_map_clone(map)
    expect(sparse_map_get(cloned, 1)).toBe("one")
    sparse_map_set(map, 1, "new")
    expect(sparse_map_get(cloned, 1)).toBe("one") // Verify it's a separate copy
  })
})
