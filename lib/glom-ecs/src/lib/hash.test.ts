import {describe, expect, test} from "bun:test"
import {HASH_BASE, hash_to_uint, hash_word, hash_words, init_hash} from "./hash"

describe("hash", () => {
  test("init_hash returns HASH_BASE", () => {
    expect(init_hash()).toBe(HASH_BASE)
  })

  test("hash_word is deterministic", () => {
    const h1 = hash_word(HASH_BASE, 123)
    const h2 = hash_word(HASH_BASE, 123)
    expect(h1).toBe(h2)
  })

  test("hash_word changes with different inputs", () => {
    const h1 = hash_word(HASH_BASE, 123)
    const h2 = hash_word(HASH_BASE, 124)
    expect(h1).not.toBe(h2)
  })

  test("hash_words is deterministic", () => {
    const h1 = hash_words([1, 2, 3])
    const h2 = hash_words([1, 2, 3])
    expect(h1).toBe(h2)
  })

  test("hash_words changes with different inputs", () => {
    const h1 = hash_words([1, 2, 3])
    const h2 = hash_words([1, 2, 4])
    const h3 = hash_words([1, 3, 2])
    expect(h1).not.toBe(h2)
    expect(h1).not.toBe(h3)
  })

  test("hash_words handles empty array", () => {
    expect(hash_words([])).toBe(HASH_BASE)
  })

  test("hash_to_uint returns unsigned 32-bit integer", () => {
    const h = hash_word(HASH_BASE, 123)
    const uint = hash_to_uint(h)
    expect(uint).toBeGreaterThanOrEqual(0)
    expect(uint).toBeLessThan(2 ** 32)
    expect(uint).toBe(h >>> 0)
  })
})
