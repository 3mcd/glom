import {describe, expect, test} from "bun:test"
import {HASH_BASE, hashToUint, hashWord, hashWords, initHash} from "./hash"

describe("hash", () => {
  test("initHash returns HASH_BASE", () => {
    expect(initHash()).toBe(HASH_BASE)
  })

  test("hashWord is deterministic", () => {
    const h1 = hashWord(HASH_BASE, 123)
    const h2 = hashWord(HASH_BASE, 123)
    expect(h1).toBe(h2)
  })

  test("hashWord changes with different inputs", () => {
    const h1 = hashWord(HASH_BASE, 123)
    const h2 = hashWord(HASH_BASE, 124)
    expect(h1).not.toBe(h2)
  })

  test("hashWords is deterministic", () => {
    const h1 = hashWords([1, 2, 3])
    const h2 = hashWords([1, 2, 3])
    expect(h1).toBe(h2)
  })

  test("hashWords changes with different inputs", () => {
    const h1 = hashWords([1, 2, 3])
    const h2 = hashWords([1, 2, 4])
    const h3 = hashWords([1, 3, 2])
    expect(h1).not.toBe(h2)
    expect(h1).not.toBe(h3)
  })

  test("hashWords handles empty array", () => {
    expect(hashWords([])).toBe(HASH_BASE)
  })

  test("hashToUint returns unsigned 32-bit integer", () => {
    const h = hashWord(HASH_BASE, 123)
    const uint = hashToUint(h)
    expect(uint).toBeGreaterThanOrEqual(0)
    expect(uint).toBeLessThan(2 ** 32)
    expect(uint).toBe(h >>> 0)
  })
})
