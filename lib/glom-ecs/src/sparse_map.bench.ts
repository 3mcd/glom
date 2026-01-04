import {bench, group, run} from "mitata"
import {
  make_sparse_map,
  sparse_map_set,
  sparse_map_get,
  sparse_map_delete,
} from "./sparse_map"

const size = 1000
const sparse_map = make_sparse_map<number>()
const keys = Array.from({length: size}, (_, i) => i)
const random_keys = Array.from({length: size}, () =>
  Math.floor(Math.random() * size * 2),
)

group("sparse_map operations", () => {
  bench("sparse_map_set (sequential)", () => {
    const map = make_sparse_map<number>()
    for (let i = 0; i < size; i++) {
      sparse_map_set(map, i, i)
    }
  })

  bench("sparse_map_set (random)", () => {
    const map = make_sparse_map<number>()
    for (let i = 0; i < size; i++) {
      sparse_map_set(map, random_keys[i]!, i)
    }
  })

  for (let i = 0; i < size; i++) {
    sparse_map_set(sparse_map, i, i)
  }

  bench("sparse_map_get", () => {
    for (let i = 0; i < size; i++) {
      sparse_map_get(sparse_map, i)
    }
  })

  bench("sparse_map_delete", () => {
    const map = make_sparse_map<number>()
    for (let i = 0; i < size; i++) sparse_map_set(map, i, i)

    for (let i = 0; i < size; i++) {
      sparse_map_delete(map, i)
    }
  })
})

await run()
