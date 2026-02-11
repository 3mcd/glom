import {describe, expect, test} from "bun:test"
import * as SparseSet from "./sparse_set"

describe("sparseSet", () => {
  test("add and has", () => {
    const set = SparseSet.create<number>()
    SparseSet.add(set, 10)
    SparseSet.add(set, 20)

    expect(SparseSet.has(set, 10)).toBe(true)
    expect(SparseSet.has(set, 20)).toBe(true)
    expect(SparseSet.has(set, 30)).toBe(false)
  })

  test("add returns index", () => {
    const set = SparseSet.create<number>()
    expect(SparseSet.add(set, 10)).toBe(0)
    expect(SparseSet.add(set, 20)).toBe(1)
    expect(SparseSet.add(set, 10)).toBe(0)
  })

  test("at", () => {
    const set = SparseSet.create<number>()
    SparseSet.add(set, 10)
    SparseSet.add(set, 20)
    expect(SparseSet.at(set, 0)).toBe(10)
    expect(SparseSet.at(set, 1)).toBe(20)
  })

  test("indexOf", () => {
    const set = SparseSet.create<number>()
    SparseSet.add(set, 10)
    expect(SparseSet.indexOf(set, 10)).toBe(0)
    expect(SparseSet.indexOf(set, 20)).toBe(-1)
  })

  test("delete", () => {
    const set = SparseSet.create<number>()
    SparseSet.add(set, 1)
    SparseSet.add(set, 2)
    SparseSet.add(set, 3)

    SparseSet.del(set, 2)
    expect(SparseSet.has(set, 2)).toBe(false)
    expect(SparseSet.size(set)).toBe(2)

    expect(SparseSet.at(set, 0)).toBe(1)
    expect(SparseSet.at(set, 1)).toBe(3)
    expect(SparseSet.indexOf(set, 3)).toBe(1)
  })

  test("clear", () => {
    const set = SparseSet.create<number>()
    SparseSet.add(set, 1)
    SparseSet.add(set, 2)
    SparseSet.clear(set)
    expect(SparseSet.size(set)).toBe(0)
    expect(SparseSet.has(set, 1)).toBe(false)
    expect(SparseSet.has(set, 2)).toBe(false)
  })

  test("values", () => {
    const set = SparseSet.create<number>()
    SparseSet.add(set, 1)
    SparseSet.add(set, 2)
    expect(SparseSet.values(set)).toEqual([1, 2])
  })

  test("size", () => {
    const set = SparseSet.create<number>()
    expect(SparseSet.size(set)).toBe(0)
    SparseSet.add(set, 1)
    expect(SparseSet.size(set)).toBe(1)
  })

  test("forEach", () => {
    const set = SparseSet.create<number>()
    SparseSet.add(set, 1)
    SparseSet.add(set, 2)
    const results: number[] = []
    SparseSet.forEach(set, (v) => results.push(v))

    expect(results).toEqual([2, 1])
  })
})
