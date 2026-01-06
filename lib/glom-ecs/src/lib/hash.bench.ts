import {bench, group, run} from "mitata"
import {HASH_BASE, hashWord, hashWords} from "./hash"

group("hash", () => {
  bench("hashWord", () => {
    hashWord(HASH_BASE, 12345)
  })

  const words5 = Array.from({length: 5}, (_, i) => i)
  bench("hashWords (5 words)", () => {
    hashWords(words5)
  })

  const words20 = Array.from({length: 20}, (_, i) => i)
  bench("hashWords (20 words)", () => {
    hashWords(words20)
  })

  const words100 = Array.from({length: 100}, (_, i) => i)
  bench("hashWords (100 words)", () => {
    hashWords(words100)
  })
})

await run()
