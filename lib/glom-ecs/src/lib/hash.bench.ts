import {bench, group, run} from "mitata"
import {HASH_BASE, hash_word, hash_words} from "./hash"

group("hash", () => {
  bench("hash_word", () => {
    hash_word(HASH_BASE, 12345)
  })

  const words5 = Array.from({length: 5}, (_, i) => i)
  bench("hash_words (5 words)", () => {
    hash_words(words5)
  })

  const words20 = Array.from({length: 20}, (_, i) => i)
  bench("hash_words (20 words)", () => {
    hash_words(words20)
  })

  const words100 = Array.from({length: 100}, (_, i) => i)
  bench("hash_words (100 words)", () => {
    hash_words(words100)
  })
})

await run()
