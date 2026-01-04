import {describe, expect, test} from "bun:test"
import {
  make_sparse_set,
  sparse_set_add,
  sparse_set_at,
  sparse_set_clear,
  sparse_set_delete,
  sparse_set_for_each,
  sparse_set_has,
  sparse_set_index_of,
  sparse_set_size,
  sparse_set_values,
} from "./sparse_set"

describe("sparse_set", () => {
  test("add and has", () => {
    const set = make_sparse_set<number>()
    sparse_set_add(set, 10)
    sparse_set_add(set, 20)

    expect(sparse_set_has(set, 10)).toBe(true)
    expect(sparse_set_has(set, 20)).toBe(true)
    expect(sparse_set_has(set, 30)).toBe(false)
  })

  test("add returns index", () => {
    const set = make_sparse_set<number>()
    expect(sparse_set_add(set, 10)).toBe(0)
    expect(sparse_set_add(set, 20)).toBe(1)
    expect(sparse_set_add(set, 10)).toBe(0)
  })

  test("at", () => {
    const set = make_sparse_set<number>()
    sparse_set_add(set, 10)
    sparse_set_add(set, 20)
    expect(sparse_set_at(set, 0)).toBe(10)
    expect(sparse_set_at(set, 1)).toBe(20)
  })

  test("index_of", () => {
    const set = make_sparse_set<number>()
    sparse_set_add(set, 10)
    expect(sparse_set_index_of(set, 10)).toBe(0)
    expect(sparse_set_index_of(set, 20)).toBe(-1)
  })

  test("delete", () => {
    const set = make_sparse_set<number>()
    sparse_set_add(set, 1)
    sparse_set_add(set, 2)
    sparse_set_add(set, 3)

    sparse_set_delete(set, 2)
    expect(sparse_set_has(set, 2)).toBe(false)
    expect(sparse_set_size(set)).toBe(2)

    // Check swap-and-pop
    expect(sparse_set_at(set, 0)).toBe(1)
    expect(sparse_set_at(set, 1)).toBe(3)
    expect(sparse_set_index_of(set, 3)).toBe(1)
  })

  test("clear", () => {
    const set = make_sparse_set<number>()
    sparse_set_add(set, 1)
    sparse_set_add(set, 2)
    sparse_set_clear(set)
    expect(sparse_set_size(set)).toBe(0)
    expect(sparse_set_has(set, 1)).toBe(false)
    expect(sparse_set_has(set, 2)).toBe(false)
  })

  test("values", () => {
    const set = make_sparse_set<number>()
    sparse_set_add(set, 1)
    sparse_set_add(set, 2)
    expect(sparse_set_values(set)).toEqual([1, 2])
  })

  test("size", () => {
    const set = make_sparse_set<number>()
    expect(sparse_set_size(set)).toBe(0)
    sparse_set_add(set, 1)
    expect(sparse_set_size(set)).toBe(1)
  })

  test("for_each", () => {
    const set = make_sparse_set<number>()
    sparse_set_add(set, 1)
    sparse_set_add(set, 2)
    const results: number[] = []
    sparse_set_for_each(set, (v) => results.push(v))
    // Iterates backwards
    expect(results).toEqual([2, 1])
  })
})
