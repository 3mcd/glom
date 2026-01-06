import {assertDefined} from "../assert"
import type {ComponentLike} from "../component"
import type {AllDescriptor as RawAllDescriptor} from "../descriptors"
import type {Entity} from "../entity"
import {
  type EntityGraphNode,
  type EntityGraphNodeListener,
  entityGraphFindOrCreateNode,
  entityGraphNodeAddListener,
  entityGraphNodeRemoveListener,
} from "../entity_graph"
import {isRelationship, type Relation} from "../relation"
import {getOrCreateVirtualId} from "../relation_registry"
import {
  makeSparseMap,
  sparseMapClear,
  sparseMapDelete,
  sparseMapGet,
  sparseMapSet,
} from "../sparse_map"
import {makeVec, type Vec, vecIsSupersetOf} from "../vec"
import {getComponentStore, type World} from "../world"
import type {AnyAll} from "./all"

export type TermInfo =
  | {type: "entity"; joinIndex: number}
  | {
      type: "component"
      component: ComponentLike
      componentId: number
      store: unknown[] | undefined
      joinIndex: number
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
  | {
      type: "rel"
      relation: Relation
      relationId: number
      objectTerm: TermInfo
      joinIndex: number
      nextJoinIndex: number
    }

export class JoinLevel implements EntityGraphNodeListener {
  readonly nodes: EntityGraphNode[] = []
  readonly nodesMap = makeSparseMap<EntityGraphNode>()
  readonly requiredVec: Vec
  readonly excludedVecs: Vec[]
  readonly joinOn?: {readonly id: number}
  readonly anchorNode: EntityGraphNode

  constructor(
    world: World,
    required: ComponentLike[],
    excluded: ComponentLike[],
    joinOn?: {readonly id: number},
  ) {
    this.requiredVec = makeVec(required, world.componentRegistry)
    this.excludedVecs = excluded.map((c) =>
      makeVec([c], world.componentRegistry),
    )
    this.joinOn = joinOn

    this.anchorNode = entityGraphFindOrCreateNode(
      world.entityGraph,
      this.requiredVec,
    )
    entityGraphNodeAddListener(this.anchorNode, this, true)
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

    if (!sparseMapGet(this.nodesMap, node.id)) {
      sparseMapSet(this.nodesMap, node.id, node)
      this.nodes.push(node)
    }
  }

  nodeDestroyed(node: EntityGraphNode): void {
    if (sparseMapGet(this.nodesMap, node.id)) {
      sparseMapDelete(this.nodesMap, node.id)
      const idx = this.nodes.indexOf(node)
      if (idx !== -1) {
        this.nodes.splice(idx, 1)
      }
    }
  }

  teardown(): void {
    entityGraphNodeRemoveListener(this.anchorNode, this)
    sparseMapClear(this.nodesMap)
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

  get nodes() {
    return this.joins[0]?.nodesMap || makeSparseMap<EntityGraphNode>()
  }

  get _anchor_node() {
    return this.joins[0]?.anchorNode
  }

  constructor(readonly desc: RawAllDescriptor) {}

  *[Symbol.iterator](): Iterator<unknown[]> {
    if (this.joins.length === 0) return

    const rootJoin = this.joins[0]
    if (!rootJoin) return
    const nodes = rootJoin.nodes

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i] as EntityGraphNode
      const entities = node.entities.dense

      for (let j = 0; j < entities.length; j++) {
        const entity = entities[j] as Entity
        yield* this._yield_entity(
          entity,
          node,
          0,
          new Array(this._term_infos.length),
        )
      }
    }
  }

  private *_yield_entity(
    entity: Entity,
    node: EntityGraphNode,
    termIdx: number,
    currentResult: unknown[],
  ): IterableIterator<unknown[]> {
    if (termIdx === this._term_infos.length) {
      yield [...currentResult]
      return
    }

    const info = this._term_infos[termIdx] as TermInfo
    const values = this._get_term_values(entity, info, node)

    for (const val of values) {
      currentResult[termIdx] = val
      yield* this._yield_entity(entity, node, termIdx + 1, currentResult)
    }
  }

  private _get_term_values(
    entity: Entity,
    info: TermInfo,
    node?: EntityGraphNode,
  ): unknown[] {
    const world = this._world
    assertDefined(world)
    if (info.type === "entity") return [entity]
    if (info.type === "component") {
      const actualNode =
        node ?? sparseMapGet(world.entityGraph.byEntity, entity as number)
      if (!actualNode) return []

      const componentId = info.componentId
      if (!actualNode.vec.sparse.has(componentId)) return []

      if (!info.store) return [undefined]
      const index = sparseMapGet(world.index.entityToIndex, entity)
      if (index === undefined) return []
      const val = info.store[index]
      return val === undefined ? [] : [val]
    }
    if (info.type === "has" || info.type === "not") {
      const actualNode =
        node ?? sparseMapGet(world.entityGraph.byEntity, entity as number)
      if (!actualNode) return info.type === "not" ? [undefined] : []

      const componentId = info.componentId
      const hasComponent = actualNode.vec.sparse.has(componentId)

      if (info.type === "has") {
        return hasComponent ? [undefined] : []
      } else {
        return hasComponent ? [] : [undefined]
      }
    }
    if (info.type === "rel") {
      const nextJoin = this.joins[info.nextJoinIndex]
      if (!nextJoin) return []

      const results: unknown[] = []
      const relationId = info.relationId

      for (let i = 0; i < nextJoin.nodes.length; i++) {
        const n = nextJoin.nodes[i] as EntityGraphNode
        const relMap = n.relMaps[relationId]
        if (!relMap) continue

        const targets = relMap.subjectToObjects.get(entity as number)
        if (!targets) continue

        const targetEntities = targets.dense
        for (let j = 0; j < targetEntities.length; j++) {
          const targetEntity = targetEntities[j] as Entity
          results.push(
            ...this._get_term_values(targetEntity, info.objectTerm, n),
          )
        }
      }
      return results
    }
    return []
  }

  setup(world: World): void {
    this._world = world
    this.entityToIndex = world.index.entityToIndex

    const context = {joinIndex: 0}
    this._term_infos = this.desc.all.map((term: unknown) =>
      this._resolve_term_info(term, world, 0, context),
    )

    const joinConfigs: {
      required: ComponentLike[][]
      excluded: ComponentLike[][]
      joinOn: (Relation | undefined)[]
    } = {
      required: [],
      excluded: [],
      joinOn: [],
    }

    const collectContext = {joinIndex: 0}
    for (let i = 0; i < this.desc.all.length; i++) {
      this._collect_join_components(
        this.desc.all[i],
        0,
        joinConfigs,
        world,
        collectContext,
      )
    }

    for (let i = 0; i <= collectContext.joinIndex; i++) {
      const joinOn = joinConfigs.joinOn[i]
      this.joins.push(
        new JoinLevel(
          world,
          joinConfigs.required[i] || [],
          joinConfigs.excluded[i] || [],
          joinOn ? {id: world.componentRegistry.getId(joinOn)} : undefined,
        ),
      )
    }

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
    if ((typeof term !== "object" && typeof term !== "function") || term === null) {
      throw new Error("Invalid term descriptor")
    }
    const t = term as Record<string, unknown>

    if ("entity" in t) {
      return {type: "entity", joinIndex: currentJoinIndex}
    }
    if ("rel" in t) {
      const relTuple = t.rel as [Relation, unknown]
      const nextJoinIndex = ++context.joinIndex
      return {
        type: "rel",
        relation: relTuple[0],
        relationId: world.componentRegistry.getId(relTuple[0]),
        objectTerm: this._resolve_term_info(
          relTuple[1],
          world,
          nextJoinIndex,
          context,
        ),
        joinIndex: currentJoinIndex,
        nextJoinIndex: nextJoinIndex,
      }
    }

    let component: ComponentLike
    let type: "component" | "has" | "not" = "component"

    if ("has" in t) {
      component = t.has as ComponentLike
      type = "has"
    } else if ("not" in t) {
      component = t.not as ComponentLike
      type = "not"
    } else if ("read" in t) {
      component = t.read as ComponentLike
    } else if ("write" in t) {
      component = t.write as ComponentLike
    } else {
      component = term as ComponentLike
    }

    if (isRelationship(component)) {
      const vid = getOrCreateVirtualId(
        world,
        component.relation,
        component.object,
      )
      component = world.componentRegistry.getVirtualComponent(vid)
    }

    if (
      component &&
      typeof component === "object" &&
      "component" in (component as Record<string, unknown>)
    ) {
      component = (component as Record<string, unknown>)
        .component as ComponentLike
    }

    const componentId = world.componentRegistry.getId(component)

    if (type === "has") {
      return {
        type: "has",
        component,
        componentId,
        joinIndex: currentJoinIndex,
      }
    }
    if (type === "not") {
      return {
        type: "not",
        component,
        componentId,
        joinIndex: currentJoinIndex,
      }
    }

    const store = getComponentStore(world, component)
    return {
      type: "component",
      component,
      componentId,
      store,
      joinIndex: currentJoinIndex,
    }
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
    if (typeof term !== "object" || term === null) return
    const t = term as Record<string, unknown>

    if (!configs.required[currentJoinIndex]) {
      configs.required[currentJoinIndex] = []
      configs.excluded[currentJoinIndex] = []
    }

    if ("rel" in t) {
      const relTuple = t.rel as [Relation, unknown]
      const nextJoinIndex = ++context.joinIndex
      configs.joinOn[nextJoinIndex] = relTuple[0]
      this._collect_join_components(
        relTuple[1],
        nextJoinIndex,
        configs,
        world,
        context,
      )
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
      component = world.componentRegistry.getVirtualComponent(vid)
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
    } else if (info.type === "rel") {
      this._collect_stores(info.objectTerm, stores)
    }
  }

  teardown(): void {
    for (const join of this.joins) {
      join.teardown()
    }
    this.joins.length = 0
    this._world = undefined
    this._term_infos = []
    this.stores.length = 0
  }
}

export function makeAll(desc: RawAllDescriptor): AnyAll {
  return new AllRuntime(desc)
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
