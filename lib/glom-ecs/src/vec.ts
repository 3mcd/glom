import { assert_defined } from "./assert"
import type { ComponentLike } from "./component"
import { hash_word, hash_words } from "./lib/hash"
import type { ComponentRegistry } from "./registry"

export type Vec = {
  readonly elements: ComponentLike[]
  readonly ids: number[]
  readonly hash: number
  readonly sparse: Map<number, number>
  readonly sums: WeakMap<Vec, Vec>
  readonly differences: WeakMap<Vec, Vec>
  readonly intersections: WeakMap<Vec, Vec>
}

export function make_vec(
  components: ComponentLike[],
  registry: ComponentRegistry,
): Vec {
  const elements: ComponentLike[] = []
  const seen = new Set<number>()
  for (let i = 0; i < components.length; i++) {
    const c = components[i]
    assert_defined(c)
    const id = registry.get_id(c)
    if (!seen.has(id)) {
      elements.push(c)
      seen.add(id)
    }
  }
  elements.sort((a, b) => registry.get_id(a) - registry.get_id(b))
  return make_vec_sorted(elements, registry)
}

export function make_vec_sorted(
  elements: ComponentLike[],
  registry: ComponentRegistry,
): Vec {
  const ids = elements.map((c) => registry.get_id(c))
  const sparse = new Map<number, number>()
  for (let i = 0; i < elements.length; i++) {
    const component = elements[i]
    assert_defined(component)
    sparse.set(registry.get_id(component), i)
  }
  return {
    elements,
    ids,
    hash: hash_words(ids),
    sparse,
    sums: new WeakMap(),
    differences: new WeakMap(),
    intersections: new WeakMap(),
  }
}

export function vec_has(
  vec: Vec,
  component: ComponentLike,
  registry: ComponentRegistry,
): boolean {
  return vec.ids.includes(registry.get_id(component))
}

export function vec_xor_hash(a: Vec, b: Vec): number {
  if (a.hash === b.hash) {
    return 0
  }
  const a_len = a.ids.length
  const b_len = b.ids.length
  let a_idx = 0
  let b_idx = 0
  let xor = 0
  while (a_idx < a_len && b_idx < b_len) {
    const a_id = a.ids[a_idx]
    const b_id = b.ids[b_idx]
    assert_defined(a_id)
    assert_defined(b_id)
    if (a_id === b_id) {
      a_idx++
      b_idx++
    } else if (a_id < b_id) {
      xor = hash_word(xor, a_id)
      a_idx++
    } else {
      xor = hash_word(xor, b_id)
      b_idx++
    }
  }
  while (a_idx < a_len) {
    const a_id = a.ids[a_idx]
    assert_defined(a_id)
    xor = hash_word(xor, a_id)
    a_idx++
  }
  while (b_idx < b_len) {
    const b_id = b.ids[b_idx]
    assert_defined(b_id)
    xor = hash_word(xor, b_id)
    b_idx++
  }
  return xor >>> 0
}

export function vec_is_superset_of(a: Vec, b: Vec): boolean {
  if (a.hash === b.hash) {
    return true
  }
  if (b.ids.length === 0) {
    return true
  }
  if (a.ids.length < b.ids.length) {
    return false
  }
  const a_len = a.ids.length
  const b_len = b.ids.length
  let a_idx = 0
  let b_idx = 0
  while (a_idx < a_len && b_idx < b_len) {
    const a_id = a.ids[a_idx]
    const b_id = b.ids[b_idx]
    assert_defined(a_id)
    assert_defined(b_id)
    if (a_id < b_id) {
      a_idx++
    } else if (a_id > b_id) {
      return false
    } else {
      a_idx++
      b_idx++
    }
  }
  return b_idx === b.ids.length
}

export function vec_sum(a: Vec, b: Vec, registry: ComponentRegistry): Vec {
  let cached = a.sums.get(b)
  if (cached) {
    return cached
  }
  const a_len = a.ids.length
  const b_len = b.ids.length
  const sum: ComponentLike[] = []
  let a_idx = 0
  let b_idx = 0
  while (a_idx < a_len && b_idx < b_len) {
    const a_id = a.ids[a_idx]
    const b_id = b.ids[b_idx]
    assert_defined(a_id)
    assert_defined(b_id)
    if (a_id === b_id) {
      const element = a.elements[a_idx]
      assert_defined(element)
      sum.push(element)
      a_idx++
      b_idx++
    } else if (a_id < b_id) {
      const element = a.elements[a_idx]
      assert_defined(element)
      sum.push(element)
      a_idx++
    } else {
      const element = b.elements[b_idx]
      assert_defined(element)
      sum.push(element)
      b_idx++
    }
  }
  while (a_idx < a_len) {
    const element = a.elements[a_idx]
    assert_defined(element)
    sum.push(element)
    a_idx++
  }
  while (b_idx < b_len) {
    const element = b.elements[b_idx]
    assert_defined(element)
    sum.push(element)
    b_idx++
  }
  cached = make_vec_sorted(sum, registry)
  a.sums.set(b, cached)
  b.sums.set(a, cached)
  return cached
}

export function vec_difference(
  a: Vec,
  b: Vec,
  registry: ComponentRegistry,
): Vec {
  let cached = a.differences.get(b)
  if (cached) {
    return cached
  }
  const a_len = a.ids.length
  const b_len = b.ids.length
  const difference: ComponentLike[] = []
  let a_idx = 0
  let b_idx = 0
  while (a_idx < a_len && b_idx < b_len) {
    const a_id = a.ids[a_idx]
    const b_id = b.ids[b_idx]
    assert_defined(a_id)
    assert_defined(b_id)
    if (a_id === b_id) {
      a_idx++
      b_idx++
    } else if (a_id < b_id) {
      const element = a.elements[a_idx]
      assert_defined(element)
      difference.push(element)
      a_idx++
    } else {
      b_idx++
    }
  }
  while (a_idx < a_len) {
    const element = a.elements[a_idx]
    assert_defined(element)
    difference.push(element)
    a_idx++
  }
  cached = make_vec_sorted(difference, registry)
  a.differences.set(b, cached)
  b.differences.set(a, cached)
  return cached
}

export function vec_intersection(
  a: Vec,
  b: Vec,
  registry: ComponentRegistry,
): Vec {
  let cached = a.intersections.get(b)
  if (cached) {
    return cached
  }
  const a_len = a.ids.length
  const b_len = b.ids.length
  const intersection: ComponentLike[] = []
  let a_idx = 0
  let b_idx = 0
  while (a_idx < a_len && b_idx < b_len) {
    const a_id = a.ids[a_idx]
    const b_id = b.ids[b_idx]
    assert_defined(a_id)
    assert_defined(b_id)
    if (a_id === b_id) {
      const element = a.elements[a_idx]
      assert_defined(element)
      intersection.push(element)
      a_idx++
      b_idx++
    } else if (a_id < b_id) {
      a_idx++
    } else {
      b_idx++
    }
  }
  cached = make_vec_sorted(intersection, registry)
  a.intersections.set(b, cached)
  b.intersections.set(a, cached)
  return cached
}
