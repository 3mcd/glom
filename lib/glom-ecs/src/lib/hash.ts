export const HASH_BASE = 0x811c9dc5 | 0
export const HASH_ENTROPY = 0x01000193 | 0

export function initHash(): number {
  return HASH_BASE
}

export function hashWord(hash: number = HASH_BASE, term: number): number {
  return Math.imul(hash ^ term, HASH_ENTROPY)
}

export function hashWords(words: number[]): number {
  let hash = initHash()
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!
    hash = hashWord(hash, word)
  }
  return hash
}

export function hashToUint(hash: number): number {
  return hash >>> 0
}
