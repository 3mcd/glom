import {describe, expect, test} from "bun:test"
import {
  makeSparseSet,
  sparseSetAdd,
  sparseSetAt,
  sparseSetClear,
  sparseSetDelete,
  sparseSetForEach,
  sparseSetHas,
  sparseSetIndexOf,
  sparseSetSize,
  sparseSetValues,
} from "./sparse_set"

describe("sparseSet", () => {
  test("add and has", () => {
    const set = makeSparseSet<number>()
    sparseSetAdd(set, 10)
    sparseSetAdd(set, 20)

    expect(sparseSetHas(set, 10)).toBe(true)
    expect(sparseSetHas(set, 20)).toBe(true)
    expect(sparseSetHas(set, 30)).toBe(false)
  })

  test("add returns index", () => {
    const set = makeSparseSet<number>()
    expect(sparseSetAdd(set, 10)).toBe(0)
    expect(sparseSetAdd(set, 20)).toBe(1)
    expect(sparseSetAdd(set, 10)).toBe(0)
  })

  test("at", () => {
    const set = makeSparseSet<number>()
    sparseSetAdd(set, 10)
    sparseSetAdd(set, 20)
    expect(sparseSetAt(set, 0)).toBe(10)
    expect(sparseSetAt(set, 1)).toBe(20)
  })

  test("indexOf", () => {
    const set = makeSparseSet<number>()
    sparseSetAdd(set, 10)
    expect(sparseSetIndexOf(set, 10)).toBe(0)
    expect(sparseSetIndexOf(set, 20)).toBe(-1)
  })

  test("delete", () => {
    const set = makeSparseSet<number>()
    sparseSetAdd(set, 1)
    sparseSetAdd(set, 2)
    sparseSetAdd(set, 3)

    sparseSetDelete(set, 2)
    expect(sparseSetHas(set, 2)).toBe(false)
    expect(sparseSetSize(set)).toBe(2)

    expect(sparseSetAt(set, 0)).toBe(1)
    expect(sparseSetAt(set, 1)).toBe(3)
    expect(sparseSetIndexOf(set, 3)).toBe(1)
  })

  test("clear", () => {
    const set = makeSparseSet<number>()
    sparseSetAdd(set, 1)
    sparseSetAdd(set, 2)
    sparseSetClear(set)
    expect(sparseSetSize(set)).toBe(0)
    expect(sparseSetHas(set, 1)).toBe(false)
    expect(sparseSetHas(set, 2)).toBe(false)
  })

  test("values", () => {
    const set = makeSparseSet<number>()
    sparseSetAdd(set, 1)
    sparseSetAdd(set, 2)
    expect(sparseSetValues(set)).toEqual([1, 2])
  })

  test("size", () => {
    const set = makeSparseSet<number>()
    expect(sparseSetSize(set)).toBe(0)
    sparseSetAdd(set, 1)
    expect(sparseSetSize(set)).toBe(1)
  })

  test("forEach", () => {
    const set = makeSparseSet<number>()
    sparseSetAdd(set, 1)
    sparseSetAdd(set, 2)
    const results: number[] = []
    sparseSetForEach(set, (v) => results.push(v))

    expect(results).toEqual([2, 1])
  })
})
