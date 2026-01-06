export type SparseMap<T = unknown> = {
  dense: T[]
  sparse: Map<number, number>
  indices: number[]
}

export function makeSparseMap<T = unknown>(): SparseMap<T> {
  return {
    dense: [],
    sparse: new Map(),
    indices: [],
  }
}

export function sparseMapGet<T>(
  map: SparseMap<T>,
  key: number,
): T | undefined {
  const denseIndex = map.sparse.get(key)
  if (denseIndex === undefined) {
    return undefined
  }
  return map.dense[denseIndex]
}

export function sparseMapSet<T>(
  map: SparseMap<T>,
  key: number,
  value: T,
): void {
  const denseIndex = map.sparse.get(key)
  if (denseIndex === undefined) {
    map.sparse.set(key, map.dense.length)
    map.dense.push(value)
    map.indices.push(key)
  } else {
    map.dense[denseIndex] = value
  }
}

export function sparseMapHas(map: SparseMap, key: number): boolean {
  return map.sparse.has(key)
}

export function sparseMapDelete<T>(map: SparseMap<T>, key: number): void {
  const denseIndex = map.sparse.get(key)
  if (denseIndex === undefined) {
    return
  }
  const lastKey = map.indices[map.indices.length - 1] as number
  const lastVal = map.dense[map.dense.length - 1] as T
  map.dense[denseIndex] = lastVal
  map.dense.pop()
  map.indices[denseIndex] = lastKey
  map.indices.pop()
  map.sparse.set(lastKey, denseIndex)
  map.sparse.delete(key)
}

export function sparseMapSize(map: SparseMap): number {
  return map.dense.length
}

export function sparseMapClear(map: SparseMap): void {
  map.dense.length = 0
  map.indices.length = 0
  map.sparse.clear()
}

export function sparseMapToSparseArray<T>(
  map: SparseMap<T>,
): (T | undefined)[] {
  const sparse = new Array(map.sparse.size)
  for (let i = 0; i < map.dense.length; i++) {
    const key = map.indices[i] as number
    sparse[key] = map.dense[i]
  }
  return sparse
}

export function sparseMapForEach<T>(
  map: SparseMap<T>,
  iteratee: (key: number, value: T) => void,
): void {
  for (let i = map.dense.length - 1; i >= 0; i--) {
    iteratee(map.indices[i] as number, map.dense[i] as T)
  }
}

export function sparseMapForEachValue<T>(
  map: SparseMap<T>,
  iteratee: (value: T) => void,
): void {
  for (let i = 0; i < map.dense.length; i++) {
    iteratee(map.dense[i] as T)
  }
}

export function sparseMapClone<T>(map: SparseMap<T>): SparseMap<T> {
  const clone = makeSparseMap<T>()
  for (let i = 0; i < map.dense.length; i++) {
    sparseMapSet(clone, map.indices[i] as number, map.dense[i] as T)
  }
  return clone
}
