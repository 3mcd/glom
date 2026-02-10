import {assertDefined} from "./assert"
import type {ComponentLike} from "./component"
import {hashWord, hashWords} from "./lib/hash"
import type {ComponentRegistry} from "./registry"

export type Vec = {
  readonly elements: ComponentLike[]
  readonly ids: number[]
  readonly hash: number
  readonly sparse: Map<number, number>
  readonly sums: WeakMap<Vec, Vec>
  readonly differences: WeakMap<Vec, Vec>
  readonly intersections: WeakMap<Vec, Vec>
}

export function makeVec(
  components: ComponentLike[],
  registry: ComponentRegistry,
): Vec {
  const elements: ComponentLike[] = []
  const seen = new Set<number>()
  for (let i = 0; i < components.length; i++) {
    const c = components[i]
    assertDefined(c)
    const id = registry.getId(c)
    if (!seen.has(id)) {
      elements.push(c)
      seen.add(id)
    }
  }
  elements.sort((a, b) => registry.getId(a) - registry.getId(b))
  return makeVecSorted(elements, registry)
}

export function makeVecSorted(
  elements: ComponentLike[],
  registry: ComponentRegistry,
): Vec {
  const ids = elements.map((c) => registry.getId(c))
  const sparse = new Map<number, number>()
  for (let i = 0; i < elements.length; i++) {
    const component = elements[i]
    assertDefined(component)
    sparse.set(registry.getId(component), i)
  }
  return {
    elements,
    ids,
    hash: hashWords(ids),
    sparse,
    sums: new WeakMap(),
    differences: new WeakMap(),
    intersections: new WeakMap(),
  }
}

export function vecHas(
  vec: Vec,
  component: ComponentLike,
  registry: ComponentRegistry,
): boolean {
  return vec.ids.includes(registry.getId(component))
}

export function vecXorHash(a: Vec, b: Vec): number {
  if (a.hash === b.hash) {
    return 0
  }
  const aLen = a.ids.length
  const bLen = b.ids.length
  let aIdx = 0
  let bIdx = 0
  let xor = 0
  while (aIdx < aLen && bIdx < bLen) {
    const aId = a.ids[aIdx]
    const bId = b.ids[bIdx]
    assertDefined(aId)
    assertDefined(bId)
    if (aId === bId) {
      aIdx++
      bIdx++
    } else if (aId < bId) {
      xor = hashWord(xor, aId)
      aIdx++
    } else {
      xor = hashWord(xor, bId)
      bIdx++
    }
  }
  while (aIdx < aLen) {
    const aId = a.ids[aIdx]
    assertDefined(aId)
    xor = hashWord(xor, aId)
    aIdx++
  }
  while (bIdx < bLen) {
    const bId = b.ids[bIdx]
    assertDefined(bId)
    xor = hashWord(xor, bId)
    bIdx++
  }
  return xor >>> 0
}

export function vecIsSupersetOf(a: Vec, b: Vec): boolean {
  if (a.hash === b.hash) {
    return true
  }
  if (b.ids.length === 0) {
    return true
  }
  if (a.ids.length < b.ids.length) {
    return false
  }
  const aLen = a.ids.length
  const bLen = b.ids.length
  let aIdx = 0
  let bIdx = 0
  while (aIdx < aLen && bIdx < bLen) {
    const aId = a.ids[aIdx]
    const bId = b.ids[bIdx]
    assertDefined(aId)
    assertDefined(bId)
    if (aId < bId) {
      aIdx++
    } else if (aId > bId) {
      return false
    } else {
      aIdx++
      bIdx++
    }
  }
  return bIdx === b.ids.length
}

export function vecSum(a: Vec, b: Vec, registry: ComponentRegistry): Vec {
  let cached = a.sums.get(b)
  if (cached !== undefined) {
    return cached
  }
  const aLen = a.ids.length
  const bLen = b.ids.length
  const sum: ComponentLike[] = []
  let aIdx = 0
  let bIdx = 0
  while (aIdx < aLen && bIdx < bLen) {
    const aId = a.ids[aIdx]
    const bId = b.ids[bIdx]
    assertDefined(aId)
    assertDefined(bId)
    if (aId === bId) {
      const element = a.elements[aIdx]
      assertDefined(element)
      sum.push(element)
      aIdx++
      bIdx++
    } else if (aId < bId) {
      const element = a.elements[aIdx]
      assertDefined(element)
      sum.push(element)
      aIdx++
    } else {
      const element = b.elements[bIdx]
      assertDefined(element)
      sum.push(element)
      bIdx++
    }
  }
  while (aIdx < aLen) {
    const element = a.elements[aIdx]
    assertDefined(element)
    sum.push(element)
    aIdx++
  }
  while (bIdx < bLen) {
    const element = b.elements[bIdx]
    assertDefined(element)
    sum.push(element)
    bIdx++
  }
  cached = makeVecSorted(sum, registry)
  a.sums.set(b, cached)
  b.sums.set(a, cached)
  return cached
}

export function vecDifference(
  a: Vec,
  b: Vec,
  registry: ComponentRegistry,
): Vec {
  let cached = a.differences.get(b)
  if (cached !== undefined) {
    return cached
  }
  const aLen = a.ids.length
  const bLen = b.ids.length
  const difference: ComponentLike[] = []
  let aIdx = 0
  let bIdx = 0
  while (aIdx < aLen && bIdx < bLen) {
    const aId = a.ids[aIdx]
    const bId = b.ids[bIdx]
    assertDefined(aId)
    assertDefined(bId)
    if (aId === bId) {
      aIdx++
      bIdx++
    } else if (aId < bId) {
      const element = a.elements[aIdx]
      assertDefined(element)
      difference.push(element)
      aIdx++
    } else {
      bIdx++
    }
  }
  while (aIdx < aLen) {
    const element = a.elements[aIdx]
    assertDefined(element)
    difference.push(element)
    aIdx++
  }
  cached = makeVecSorted(difference, registry)
  a.differences.set(b, cached)
  b.differences.set(a, cached)
  return cached
}

export function vecIntersection(
  a: Vec,
  b: Vec,
  registry: ComponentRegistry,
): Vec {
  let cached = a.intersections.get(b)
  if (cached !== undefined) {
    return cached
  }
  const aLen = a.ids.length
  const bLen = b.ids.length
  const intersection: ComponentLike[] = []
  let aIdx = 0
  let bIdx = 0
  while (aIdx < aLen && bIdx < bLen) {
    const aId = a.ids[aIdx]
    const bId = b.ids[bIdx]
    assertDefined(aId)
    assertDefined(bId)
    if (aId === bId) {
      const element = a.elements[aIdx]
      assertDefined(element)
      intersection.push(element)
      aIdx++
      bIdx++
    } else if (aId < bId) {
      aIdx++
    } else {
      bIdx++
    }
  }
  cached = makeVecSorted(intersection, registry)
  a.intersections.set(b, cached)
  b.intersections.set(a, cached)
  return cached
}
