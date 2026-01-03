export type SparseSet<T extends number = number> = {
  dense: T[]
  sparse: Map<number, number>
}

export function make_sparse_set<T extends number = number>(): SparseSet<T> {
  return {
    dense: [],
    sparse: new Map(),
  }
}

export function sparse_set_has<T extends number>(
  set: SparseSet<T>,
  val: T,
): boolean {
  return set.sparse.has(val)
}

export function sparse_set_add<T extends number>(
  set: SparseSet<T>,
  val: T,
): number {
  const idx = set.sparse.get(val)
  if (idx !== undefined) {
    return idx
  }
  const new_idx = set.dense.push(val) - 1
  set.sparse.set(val, new_idx)
  return new_idx
}

export function sparse_set_at<T extends number>(
  set: SparseSet<T>,
  idx: number,
): T {
  return set.dense[idx] as T
}

export function sparse_set_index_of<T extends number>(
  set: SparseSet<T>,
  val: T,
): number {
  return set.sparse.get(val) ?? -1
}

export function sparse_set_delete<T extends number>(
  set: SparseSet<T>,
  val: T,
): void {
  const idx = set.sparse.get(val)
  if (idx === undefined) {
    return
  }
  const last_val = set.dense[set.dense.length - 1] as T
  set.dense[idx] = last_val
  set.dense.pop()
  set.sparse.set(last_val, idx)
  set.sparse.delete(val)
}

export function sparse_set_clear<T extends number>(set: SparseSet<T>): void {
  set.dense.length = 0
  set.sparse.clear()
}

export function sparse_set_values<T extends number>(set: SparseSet<T>): T[] {
  return set.dense
}

export function sparse_set_size<T extends number>(set: SparseSet<T>): number {
  return set.dense.length
}

export function sparse_set_for_each<T extends number>(
  set: SparseSet<T>,
  iteratee: (val: T) => void,
): void {
  for (let i = set.dense.length - 1; i >= 0; i--) {
    iteratee(set.dense[i] as T)
  }
}
