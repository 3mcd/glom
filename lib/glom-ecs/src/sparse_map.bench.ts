import {bench, group, run} from "mitata"
import * as SparseMap from "./sparse_map"

const size = 1000
const sparseMap = SparseMap.create<number>()
const _keys = Array.from({length: size}, (_, i) => i)
const randomKeys = Array.from({length: size}, () =>
  Math.floor(Math.random() * size * 2),
)

group("sparseMap operations", () => {
  bench("sparseMapSet (sequential)", () => {
    const map = SparseMap.create<number>()
    for (let i = 0; i < size; i++) {
      SparseMap.set(map, i, i)
    }
  })

  bench("sparseMapSet (random)", () => {
    const map = SparseMap.create<number>()
    for (let i = 0; i < size; i++) {
      SparseMap.set(map, randomKeys[i]!, i)
    }
  })

  for (let i = 0; i < size; i++) {
    SparseMap.set(sparseMap, i, i)
  }

  bench("sparseMapGet", () => {
    for (let i = 0; i < size; i++) {
      SparseMap.get(sparseMap, i)
    }
  })

  bench("sparseMapDelete", () => {
    const map = SparseMap.create<number>()
    for (let i = 0; i < size; i++) SparseMap.set(map, i, i)

    for (let i = 0; i < size; i++) {
      SparseMap.del(map, i)
    }
  })
})

await run()
