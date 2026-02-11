import {assertDefined} from "../assert"
import type {ComponentLike} from "../component"
import {
  type InDescriptor,
  isInDescriptor,
  isJoinDescriptor,
  isOutDescriptor,
  type OutDescriptor,
  type AllDescriptor as RawAllDescriptor,
  type JoinDescriptor as RawJoinDescriptor,
  type UniqueDescriptor as RawUniqueDescriptor,
} from "../descriptors"
import type {Entity} from "../entity"
import {
  type EntityGraphNode,
  type EntityGraphNodeListener,
  entityGraphFindOrCreateNode,
  entityGraphNodeAddListener,
  entityGraphNodeRemoveListener,
  entityGraphNodeTraverseRight,
} from "../entity_graph"
import {isRelationship, type Relation} from "../relation"
import {getOrCreateVirtualId} from "../relation_registry"
import * as SparseMap from "../sparse_map"
import {makeVec, type Vec, vecIsSupersetOf} from "../vec"
import {
  getComponentId,
  getComponentStore,
  getEntityNode,
  resolveVirtualComponent,
  type World,
} from "../world"
import type {AnyAll} from "./all"

export type TermInfo =
  | {type: "entity"; joinIndex: number}
  | {
      type: "component"
      component: ComponentLike
      componentId: number
      store: unknown[] | undefined
      joinIndex: number
      isWrite?: boolean
    }
  | {
      type: "has"
      component: ComponentLike
      componentId: number
      joinIndex: number
    }
  | {
      type: "not"
      component: ComponentLike
      componentId: number
      joinIndex: number
    }

export class JoinLevel implements EntityGraphNodeListener {
  readonly nodes: EntityGraphNode[] = []
  readonly nodesMap = SparseMap.create<EntityGraphNode>()
  readonly requiredVec: Vec
  readonly excludedVecs: Vec[]
  readonly joinOn?: {readonly id: number}
  readonly anchorNode: EntityGraphNode
  reactiveMode?: "in" | "out"

  constructor(
    world: World,
    required: ComponentLike[],
    excluded: ComponentLike[],
    joinOn?: Relation,
  ) {
    this.requiredVec = makeVec(required, world.componentRegistry)
    this.excludedVecs = excluded.map((c) =>
      makeVec([c], world.componentRegistry),
    )
    if (joinOn !== undefined) {
      this.joinOn = {id: getComponentId(world, joinOn)}
    }

    this.anchorNode = entityGraphFindOrCreateNode(world.graph, this.requiredVec)
    entityGraphNodeAddListener(this.anchorNode, this, true)

    // Populate with existing nodes
    entityGraphNodeTraverseRight(this.anchorNode, (node) => {
      this.nodeCreated(node)
    })
  }

  get joinOnId(): number | undefined {
    return this.joinOn?.id
  }

  nodeCreated(node: EntityGraphNode): void {
    if (!vecIsSupersetOf(node.vec, this.requiredVec)) {
      return
    }

    for (let i = 0; i < this.excludedVecs.length; i++) {
      const excludedVec = this.excludedVecs[i] as Vec
      if (vecIsSupersetOf(node.vec, excludedVec)) {
        return
      }
    }

    if (!SparseMap.get(this.nodesMap, node.id)) {
      SparseMap.set(this.nodesMap, node.id, node)
      this.nodes.push(node)
    }
  }

  nodeDestroyed(node: EntityGraphNode): void {
    if (SparseMap.get(this.nodesMap, node.id)) {
      SparseMap.del(this.nodesMap, node.id)
      const idx = this.nodes.indexOf(node)
      if (idx !== -1) {
        this.nodes.splice(idx, 1)
      }
    }
  }

  teardown(): void {
    entityGraphNodeRemoveListener(this.anchorNode, this)
    SparseMap.clear(this.nodesMap)
    this.nodes.length = 0
  }
}

export class AllRuntime implements AnyAll {
  readonly __all = true
  readonly stores: unknown[][] = []
  readonly joins: JoinLevel[] = []
  entityToIndex: {
    readonly sparse: Map<number, number>
    readonly dense: number[]
  } = {sparse: new Map(), dense: []}
  protected _world?: World
  protected _term_infos: TermInfo[] = []
  protected _termResultIndex: number[] = []
  protected _resultTermCount = 0

  get nodes() {
    return this.joins[0]?.nodesMap || SparseMap.create<EntityGraphNode>()
  }

  get _anchor_node() {
    return this.joins[0]?.anchorNode
  }

  constructor(
    readonly desc: RawAllDescriptor | RawJoinDescriptor | RawUniqueDescriptor,
  ) {}

  *[Symbol.iterator](): Iterator<unknown[]> {
    if (this.joins.length === 0) return

    const rootJoin = this.joins[0]
    if (rootJoin === undefined) return

    for (let i = 0; i < rootJoin.nodes.length; i++) {
      const node = rootJoin.nodes[i] as EntityGraphNode
      const entities = node.entities.dense
      for (let j = 0; j < entities.length; j++) {
        const entity = entities[j] as Entity
        yield* this._yield_at_level(
          entity,
          node,
          0,
          new Array(this._resultTermCount),
        )
      }
    }
  }

  private *_yield_at_level(
    entity: Entity,
    node: EntityGraphNode,
    joinLevel: number,
    currentResult: unknown[],
    termIdx = 0,
  ): IterableIterator<unknown[]> {
    const terms = this._term_infos.filter((t) => t.joinIndex === joinLevel)
    yield* this._yield_terms_at_level(
      entity,
      node,
      joinLevel,
      terms,
      termIdx,
      currentResult,
    )
  }

  private *_yield_terms_at_level(
    entity: Entity,
    node: EntityGraphNode,
    joinLevel: number,
    terms: TermInfo[],
    termIdx: number,
    currentResult: unknown[],
  ): IterableIterator<unknown[]> {
    if (termIdx === terms.length) {
      // Finished all terms for this join level, move to next join or yield
      const nextJoinLevel = joinLevel + 1
      if (nextJoinLevel < this.joins.length) {
        const nextJoin = this.joins[nextJoinLevel]
        if (nextJoin?.joinOnId !== undefined) {
          yield* this._yield_independent_level(
            nextJoinLevel,
            currentResult,
            entity,
          )
          return
        } else {
          yield* this._yield_independent_level(nextJoinLevel, currentResult)
          return
        }
      }

      yield [...currentResult]
      return
    }

    const info = terms[termIdx] as TermInfo
    const values = this._get_term_values(entity, info, node)

    const globalIdx = this._term_infos.indexOf(info)
    const resultPos = this._termResultIndex[globalIdx]
    for (const val of values) {
      if (resultPos !== undefined && resultPos >= 0) {
        currentResult[resultPos] = val
      }
      yield* this._yield_terms_at_level(
        entity,
        node,
        joinLevel,
        terms,
        termIdx + 1,
        currentResult,
      )
    }
  }

  private *_yield_independent_level(
    joinLevel: number,
    currentResult: unknown[],
    subjectEntity?: Entity,
  ): IterableIterator<unknown[]> {
    const join = this.joins[joinLevel]
    if (join === undefined) return

    if (join.joinOnId !== undefined && subjectEntity !== undefined) {
      for (let i = 0; i < join.nodes.length; i++) {
        const n = join.nodes[i] as EntityGraphNode
        const relMap = n.relMaps[join.joinOnId]
        if (relMap === undefined) continue

        const targets = relMap.subjectToObjects.get(subjectEntity as number)
        if (targets === undefined) continue

        for (let j = 0; j < targets.dense.length; j++) {
          yield* this._yield_at_level(
            targets.dense[j] as Entity,
            n,
            joinLevel,
            currentResult,
          )
        }
      }
      return
    }

    for (let i = 0; i < join.nodes.length; i++) {
      const node = join.nodes[i] as EntityGraphNode
      const entities = node.entities.dense
      for (let j = 0; j < entities.length; j++) {
        yield* this._yield_at_level(
          entities[j] as Entity,
          node,
          joinLevel,
          currentResult,
        )
      }
    }
  }

  private _get_term_values(
    entity: Entity,
    info: TermInfo,
    node?: EntityGraphNode,
  ): unknown[] {
    assertDefined(this._world)
    if (info.type === "entity") return [entity]
    if (info.type === "component") {
      const actualNode = node ?? getEntityNode(this._world, entity as Entity)
      if (actualNode === undefined) return []
      if (!actualNode.vec.sparse.has(info.componentId)) return []

      if (info.store === undefined) return [undefined]
      const index = SparseMap.get(this._world.index.entityToIndex, entity)
      if (index === undefined) return []
      const val = info.store[index]
      if (val === undefined) return []

      if (info.isWrite) {
        let versions = this._world.components.versions.get(info.componentId)
        if (versions === undefined) {
          versions = new Uint32Array(1024)
          this._world.components.versions.set(info.componentId, versions)
        }
        if (index >= versions.length) {
          const next = new Uint32Array(Math.max(versions.length * 2, index + 1))
          next.set(versions)
          versions = next
          this._world.components.versions.set(info.componentId, versions)
        }
        versions[index] = this._world.tick
      }

      return [val]
    }
    if (info.type === "has" || info.type === "not") {
      const actualNode = node ?? getEntityNode(this._world, entity as Entity)
      if (actualNode === undefined)
        return info.type === "not" ? [undefined] : []

      const hasComponent = actualNode.vec.sparse.has(info.componentId)

      if (info.type === "has") {
        return hasComponent ? [undefined] : []
      } else {
        return !hasComponent ? [undefined] : []
      }
    }
    return []
  }

  setup(world: World): void {
    this._world = world
    this.entityToIndex = world.index.entityToIndex

    const joinConfigs: {
      required: ComponentLike[][]
      excluded: ComponentLike[][]
      joinOn: (Relation | undefined)[]
    } = {
      required: [],
      excluded: [],
      joinOn: [],
    }

    const context = {joinIndex: 0}
    const collectContext = {joinIndex: 0}
    const reactiveLevels: Map<number, "in" | "out"> = new Map()

    const processDescriptor = (
      desc:
        | RawAllDescriptor
        | RawJoinDescriptor
        | RawUniqueDescriptor
        | InDescriptor
        | OutDescriptor,
      joinIndex: number,
      rel?: Relation,
    ) => {
      if (rel !== undefined) {
        joinConfigs.joinOn[joinIndex] = rel
      }

      if (isInDescriptor(desc)) {
        reactiveLevels.set(joinIndex, "in")
        processDescriptor(desc.in, joinIndex)
        return
      }
      if (isOutDescriptor(desc)) {
        reactiveLevels.set(joinIndex, "out")
        processDescriptor(desc.out, joinIndex)
        return
      }

      if (isJoinDescriptor(desc)) {
        const [left, right, joinRel] = desc.join
        processDescriptor(left, joinIndex)

        const baseRightJoinIndex = collectContext.joinIndex + 1
        collectContext.joinIndex = baseRightJoinIndex
        processDescriptor(right, baseRightJoinIndex, joinRel)
      } else {
        const terms =
          (desc as RawAllDescriptor).all || (desc as RawUniqueDescriptor).unique
        terms.forEach((term: unknown) => {
          this._term_infos.push(
            this._resolve_term_info(term, world, joinIndex, context),
          )
        })
        for (let i = 0; i < terms.length; i++) {
          this._collect_join_components(
            terms[i],
            joinIndex,
            joinConfigs,
            world,
            collectContext,
          )
        }
      }
    }

    processDescriptor(this.desc, 0)

    // Compute result-index mapping: only "entity" and "component" terms
    // contribute slots in the result tuple; "has" and "not" are filter-only.
    this._termResultIndex = []
    this._resultTermCount = 0
    for (let i = 0; i < this._term_infos.length; i++) {
      const t = this._term_infos[i]!
      if (t.type === "entity" || t.type === "component") {
        this._termResultIndex.push(this._resultTermCount++)
      } else {
        this._termResultIndex.push(-1)
      }
    }

    for (let i = 0; i <= collectContext.joinIndex; i++) {
      const join = new JoinLevel(
        world,
        joinConfigs.required[i] || [],
        joinConfigs.excluded[i] || [],
        joinConfigs.joinOn[i],
      )
      join.reactiveMode = reactiveLevels.get(i)
      this.joins.push(join)
    }

    this._collect_stores_recursive()
  }

  private _collect_stores_recursive() {
    this.stores.length = 0
    this._term_infos.forEach((info) => {
      this._collect_stores(info, this.stores)
    })
  }

  private _resolve_term_info(
    term: unknown,
    world: World,
    currentJoinIndex: number,
    context: {joinIndex: number},
  ): TermInfo {
    const t = term as Record<string, unknown>
    if ("in" in t) {
      const inner = (t.in as any).all || (t.in as any).unique || t.in
      return this._resolve_term_info(inner, world, currentJoinIndex, context)
    }
    if ("out" in t) {
      const inner = (t.out as any).all || (t.out as any).unique || t.out
      return this._resolve_term_info(inner, world, currentJoinIndex, context)
    }
    if ("entity" in t) {
      return {type: "entity", joinIndex: currentJoinIndex}
    }

    let type: "component" | "has" | "not" = "component"
    let isWrite = false
    let termComp: unknown
    if ("read" in t) {
      termComp = t.read
    } else if ("write" in t) {
      termComp = t.write
      isWrite = true
    } else if ("has" in t) {
      termComp = t.has
      type = "has"
    } else if ("not" in t) {
      termComp = t.not
      type = "not"
    } else {
      termComp = term
    }

    let component: ComponentLike
    if (isRelationship(termComp)) {
      const vid = getOrCreateVirtualId(
        world,
        termComp.relation,
        termComp.object,
      )
      component = resolveVirtualComponent(world, vid)
    } else {
      component = termComp as ComponentLike
    }

    const componentId = getComponentId(world, component)

    // Downgrade tag components (isTag) from "component" to "has" — they are
    // filter-only and should not occupy a slot in the result tuple.
    if (type === "component" && component.isTag) {
      type = "has"
    }

    const info: TermInfo = {
      type,
      component,
      componentId,
      store:
        type === "component" ? getComponentStore(world, component) : undefined,
      joinIndex: currentJoinIndex,
    }
    if (type === "component" && isWrite) {
      ;(info as Extract<TermInfo, {type: "component"}>).isWrite = true
    }
    return info
  }

  private _collect_join_components(
    term: unknown,
    currentJoinIndex: number,
    configs: {
      required: ComponentLike[][]
      excluded: ComponentLike[][]
      joinOn: (Relation | undefined)[]
    },
    world: World,
    context: {joinIndex: number},
  ) {
    if (typeof term !== "object" && typeof term !== "function") return
    if (term === null) return
    const t = term as Record<string, any>

    if (!configs.required[currentJoinIndex]) {
      configs.required[currentJoinIndex] = []
      configs.excluded[currentJoinIndex] = []
    }

    if ("in" in t) {
      const inner = (t.in as any).all || (t.in as any).unique || t.in
      if (Array.isArray(inner)) {
        inner.forEach((item) => {
          this._collect_join_components(
            item,
            currentJoinIndex,
            configs,
            world,
            context,
          )
        })
      } else {
        this._collect_join_components(
          inner,
          currentJoinIndex,
          configs,
          world,
          context,
        )
      }
      return
    }
    if ("out" in t) {
      const inner = (t.out as any).all || (t.out as any).unique || t.out
      if (Array.isArray(inner)) {
        inner.forEach((item) => {
          this._collect_join_components(
            item,
            currentJoinIndex,
            configs,
            world,
            context,
          )
        })
      } else {
        this._collect_join_components(
          inner,
          currentJoinIndex,
          configs,
          world,
          context,
        )
      }
      return
    }

    if ("entity" in t) return

    let termComp: unknown
    let isExcluded = false
    if ("read" in t) {
      termComp = t.read
    } else if ("write" in t) {
      termComp = t.write
    } else if ("has" in t) {
      termComp = t.has
    } else if ("not" in t) {
      termComp = t.not
      isExcluded = true
    } else {
      termComp = term
    }

    let component: ComponentLike
    if (isRelationship(termComp)) {
      const vid = getOrCreateVirtualId(
        world,
        termComp.relation,
        termComp.object,
      )
      component = resolveVirtualComponent(world, vid)
    } else {
      component = termComp as ComponentLike
    }

    if (
      component &&
      typeof component === "object" &&
      "component" in (component as Record<string, unknown>)
    ) {
      component = (component as Record<string, unknown>)
        .component as ComponentLike
    }

    const target = isExcluded
      ? configs.excluded[currentJoinIndex]
      : configs.required[currentJoinIndex]

    if (
      target &&
      component &&
      (typeof component === "object" || typeof component === "function") &&
      ("__component_brand" in component ||
        "id" in (component as Record<string, unknown>))
    ) {
      target.push(component)
    }
  }

  private _collect_stores(info: TermInfo, stores: unknown[][]) {
    if (info.type === "component") {
      stores.push(info.store || [])
    }
  }

  matches(entity: Entity): boolean {
    const world = this._world
    if (world === undefined) return false

    const node = getEntityNode(world, entity as Entity)
    if (node === undefined) return false

    // Check if the entity's node matches the first join level
    const join0 = this.joins[0]
    if (join0 === undefined) return false
    if (SparseMap.get(join0.nodesMap, node.id) === undefined) return false

    // Try to yield at least one result for this entity
    const it = this._yield_at_level(
      entity,
      node,
      0,
      new Array(this._resultTermCount),
    )
    const {done} = it.next()
    return !done
  }

  teardown(): void {
    for (const join of this.joins) {
      join.teardown()
    }
    this.joins.length = 0
    this._world = undefined
    this._term_infos = []
    this._termResultIndex = []
    this._resultTermCount = 0
    this.stores.length = 0
  }
}

export class UniqueRuntime extends AllRuntime {
  readonly __unique = true

  constructor(override readonly desc: RawUniqueDescriptor) {
    super({all: desc.unique})
  }

  get(): unknown {
    const it = this[Symbol.iterator]()
    const result = it.next()
    if (result.done) {
      throw new Error(`Unique query failed: no entity found matching terms`)
    }
    return result.value.length === 1 ? result.value[0] : result.value
  }
}

export function makeAll(desc: RawAllDescriptor): AnyAll {
  return new AllRuntime(desc)
}

export function makeUnique(desc: RawUniqueDescriptor): AnyAll {
  return new UniqueRuntime(desc)
}

export function setupAll(all: AnyAll, world: World) {
  if (all instanceof AllRuntime) {
    all.setup(world)
  }
}

export function teardownAll(all: AnyAll) {
  if (all instanceof AllRuntime) {
    all.teardown()
  }
}
