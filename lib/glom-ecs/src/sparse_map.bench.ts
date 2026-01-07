import {bench, group, run} from "mitata"
import {
  makeSparseMap,
  sparseMapSet,
  sparseMapGet,
  sparseMapDelete,
} from "./sparse_map"

const size = 1000
const sparseMap = makeSparseMap<number>()
const _keys = Array.from({length: size}, (_, i) => i)
const randomKeys = Array.from({length: size}, () =>
  Math.floor(Math.random() * size * 2),
)

group("sparseMap operations", () => {
  bench("sparseMapSet (sequential)", () => {
    const map = makeSparseMap<number>()
    for (let i = 0; i < size; i++) {
      sparseMapSet(map, i, i)
    }
  })

  bench("sparseMapSet (random)", () => {
    const map = makeSparseMap<number>()
    for (let i = 0; i < size; i++) {
      sparseMapSet(map, randomKeys[i]!, i)
    }
  })

  for (let i = 0; i < size; i++) {
    sparseMapSet(sparseMap, i, i)
  }

  bench("sparseMapGet", () => {
    for (let i = 0; i < size; i++) {
      sparseMapGet(sparseMap, i)
    }
  })

  bench("sparseMapDelete", () => {
    const map = makeSparseMap<number>()
    for (let i = 0; i < size; i++) sparseMapSet(map, i, i)

    for (let i = 0; i < size; i++) {
      sparseMapDelete(map, i)
    }
  })
})

await run()
