export type SparseSet<T extends number = number> = {
  dense: T[]
  sparse: Map<number, number>
}

export function create<T extends number = number>(): SparseSet<T> {
  return {
    dense: [],
    sparse: new Map(),
  }
}

export function has<T extends number>(
  set: SparseSet<T>,
  val: T,
): boolean {
  return set.sparse.has(val)
}

export function add<T extends number>(
  set: SparseSet<T>,
  val: T,
): number {
  const denseIndex = set.sparse.get(val)
  if (denseIndex !== undefined) {
    return denseIndex
  }
  const newDenseIndex = set.dense.push(val) - 1
  set.sparse.set(val, newDenseIndex)
  return newDenseIndex
}

export function at<T extends number>(
  set: SparseSet<T>,
  denseIndex: number,
): T {
  return set.dense[denseIndex] as T
}

export function indexOf<T extends number>(
  set: SparseSet<T>,
  val: T,
): number {
  return set.sparse.get(val) ?? -1
}

export function del<T extends number>(
  set: SparseSet<T>,
  val: T,
): void {
  const denseIndex = set.sparse.get(val)
  if (denseIndex === undefined) {
    return
  }
  const lastVal = set.dense[set.dense.length - 1] as T
  set.dense[denseIndex] = lastVal
  set.dense.pop()
  set.sparse.set(lastVal, denseIndex)
  set.sparse.delete(val)
}

export function clear<T extends number>(set: SparseSet<T>): void {
  set.dense.length = 0
  set.sparse.clear()
}

export function values<T extends number>(set: SparseSet<T>): T[] {
  return set.dense
}

export function size<T extends number>(set: SparseSet<T>): number {
  return set.dense.length
}

export function forEach<T extends number>(
  set: SparseSet<T>,
  iteratee: (val: T) => void,
): void {
  for (let i = set.dense.length - 1; i >= 0; i--) {
    iteratee(set.dense[i] as T)
  }
}
