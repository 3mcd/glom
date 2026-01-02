export type SparseMap<T = unknown> = {
  dense: T[]
  sparse: (number | undefined)[]
  indices: number[]
}

export function make_sparse_map<T = unknown>(): SparseMap<T> {
  return {
    dense: [],
    sparse: [],
    indices: [],
  }
}

export function sparse_map_get<T>(
  map: SparseMap<T>,
  key: number,
): T | undefined {
  const d_idx = map.sparse[key]
  if (d_idx === undefined) {
    return undefined
  }
  return map.dense[d_idx]
}

export function sparse_map_set<T>(
  map: SparseMap<T>,
  key: number,
  value: T,
): void {
  const d_idx = map.sparse[key]
  if (d_idx === undefined) {
    map.sparse[key] = map.dense.length
    map.dense.push(value)
    map.indices.push(key)
  } else {
    map.dense[d_idx] = value
  }
}

export function sparse_map_has(map: SparseMap, key: number): boolean {
  return map.sparse[key] !== undefined
}

export function sparse_map_delete<T>(map: SparseMap<T>, key: number): void {
  const idx = map.sparse[key]
  if (idx === undefined) {
    return
  }
  const last_key = map.indices[map.indices.length - 1] as number
  const last_val = map.dense[map.dense.length - 1] as T
  map.dense[idx] = last_val
  map.dense.pop()
  map.indices[idx] = last_key
  map.indices.pop()
  map.sparse[last_key] = idx
  map.sparse[key] = undefined
}

export function sparse_map_size(map: SparseMap): number {
  return map.dense.length
}

export function sparse_map_clear(map: SparseMap): void {
  while (map.indices.length > 0) {
    const key = map.indices.pop() as number
    map.dense.pop()
    map.sparse[key] = undefined
  }
}

export function sparse_map_to_sparse_array<T>(
  map: SparseMap<T>,
): (T | undefined)[] {
  const sparse = new Array(map.sparse.length)
  for (let i = 0; i < map.dense.length; i++) {
    const key = map.indices[i] as number
    sparse[key] = map.dense[i]
  }
  return sparse
}

export function sparse_map_for_each<T>(
  map: SparseMap<T>,
  iteratee: (key: number, value: T) => void,
): void {
  for (let i = map.dense.length - 1; i >= 0; i--) {
    iteratee(map.indices[i] as number, map.dense[i] as T)
  }
}

export function sparse_map_for_each_value<T>(
  map: SparseMap<T>,
  iteratee: (value: T) => void,
): void {
  for (let i = 0; i < map.dense.length; i++) {
    iteratee(map.dense[i] as T)
  }
}

export function sparse_map_clone<T>(map: SparseMap<T>): SparseMap<T> {
  const clone = make_sparse_map<T>()
  for (let i = 0; i < map.dense.length; i++) {
    sparse_map_set(clone, map.indices[i] as number, map.dense[i] as T)
  }
  return clone
}
