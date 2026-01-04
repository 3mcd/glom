// biome-ignore-all lint/style/noNonNullAssertion: tests
import {bench, group, run} from "mitata"
import {
  make_sparse_set,
  sparse_set_add,
  sparse_set_delete,
  sparse_set_has,
} from "./sparse_set"

const size = 1000
const sparse_set = make_sparse_set()
const keys = Array.from({length: size}, (_, i) => i)
const random_keys = Array.from({length: size}, () =>
  Math.floor(Math.random() * size * 2),
)

group("sparse_set operations", () => {
  bench("sparse_set_add (sequential)", () => {
    const set = make_sparse_set()
    for (let i = 0; i < size; i++) {
      sparse_set_add(set, i)
    }
  })

  bench("sparse_set_add (random)", () => {
    const set = make_sparse_set()
    for (let i = 0; i < size; i++) {
      sparse_set_add(set, random_keys[i]!)
    }
  })

  // Pre-fill for has/delete benchmarks
  for (let i = 0; i < size; i++) {
    sparse_set_add(sparse_set, i)
  }

  bench("sparse_set_has", () => {
    for (let i = 0; i < size; i++) {
      sparse_set_has(sparse_set, i)
    }
  })

  bench("sparse_set_delete", () => {
    // We need a fresh set for deletion to be meaningful in a loop,
    // or we just delete keys that might not be there.
    // To keep it simple and fast, we pre-fill and then delete in the benchmark.
    // mitata runs this many times, so we should really use a fresh set.
    const set = make_sparse_set()
    for (let i = 0; i < size; i++) sparse_set_add(set, i)

    for (let i = 0; i < size; i++) {
      sparse_set_delete(set, i)
    }
  })
})

await run()
