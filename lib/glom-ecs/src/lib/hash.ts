export const HASH_BASE = 0x811c9dc5 | 0
export const HASH_ENTROPY = 0x01000193 | 0

export function init_hash(): number {
  return HASH_BASE
}

export function hash_word(hash: number = HASH_BASE, term: number): number {
  return Math.imul(hash ^ term, HASH_ENTROPY)
}

export function hash_words(words: number[]): number {
  let hash = init_hash()
  for (let i = 0; i < words.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: words is guaranteed to be non-null
    const word = words[i]!
    hash = hash_word(hash, word)
  }
  return hash
}

export function hash_to_uint(hash: number): number {
  return hash >>> 0
}
