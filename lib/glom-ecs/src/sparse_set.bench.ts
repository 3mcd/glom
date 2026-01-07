import {bench, group, run} from "mitata"
import {
  makeSparseSet,
  sparseSetAdd,
  sparseSetDelete,
  sparseSetHas,
} from "./sparse_set"

const size = 1000
const sparseSet = makeSparseSet()
const _keys = Array.from({length: size}, (_, i) => i)
const randomKeys = Array.from({length: size}, () =>
  Math.floor(Math.random() * size * 2),
)

group("sparseSet operations", () => {
  bench("sparseSetAdd (sequential)", () => {
    const set = makeSparseSet()
    for (let i = 0; i < size; i++) {
      sparseSetAdd(set, i)
    }
  })

  bench("sparseSetAdd (random)", () => {
    const set = makeSparseSet()
    for (let i = 0; i < size; i++) {
      sparseSetAdd(set, randomKeys[i]!)
    }
  })

  for (let i = 0; i < size; i++) {
    sparseSetAdd(sparseSet, i)
  }

  bench("sparseSetHas", () => {
    for (let i = 0; i < size; i++) {
      sparseSetHas(sparseSet, i)
    }
  })

  bench("sparseSetDelete", () => {
    const set = makeSparseSet()
    for (let i = 0; i < size; i++) sparseSetAdd(set, i)

    for (let i = 0; i < size; i++) {
      sparseSetDelete(set, i)
    }
  })
})

await run()
