import {bench, group, run} from "mitata"
import * as SparseSet from "./sparse_set"

const size = 1000
const sparseSet = SparseSet.create()
const _keys = Array.from({length: size}, (_, i) => i)
const randomKeys = Array.from({length: size}, () =>
  Math.floor(Math.random() * size * 2),
)

group("sparseSet operations", () => {
  bench("sparseSetAdd (sequential)", () => {
    const set = SparseSet.create()
    for (let i = 0; i < size; i++) {
      SparseSet.add(set, i)
    }
  })

  bench("sparseSetAdd (random)", () => {
    const set = SparseSet.create()
    for (let i = 0; i < size; i++) {
      SparseSet.add(set, randomKeys[i]!)
    }
  })

  for (let i = 0; i < size; i++) {
    SparseSet.add(sparseSet, i)
  }

  bench("sparseSetHas", () => {
    for (let i = 0; i < size; i++) {
      SparseSet.has(sparseSet, i)
    }
  })

  bench("sparseSetDelete", () => {
    const set = SparseSet.create()
    for (let i = 0; i < size; i++) SparseSet.add(set, i)

    for (let i = 0; i < size; i++) {
      SparseSet.del(set, i)
    }
  })
})

await run()
