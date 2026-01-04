import {assert_defined} from "../assert"
import type {ComponentLike} from "../component"
import type {AllDescriptor as RawAllDescriptor} from "../descriptors"
import type {Entity} from "../entity"
import {
  type EntityGraphNode,
  type EntityGraphNodeListener,
  entity_graph_find_or_create_node,
  entity_graph_node_add_listener,
  entity_graph_node_remove_listener,
} from "../entity_graph"
import {is_relationship, type Relation} from "../relation"
import {get_or_create_virtual_id} from "../relation_registry"
import {
  make_sparse_map,
  sparse_map_clear,
  sparse_map_delete,
  sparse_map_get,
  sparse_map_set,
} from "../sparse_map"
import {make_vec, type Vec, vec_is_superset_of} from "../vec"
import {get_component_store, type World} from "../world"
import type {AnyAll} from "./all"

export type TermInfo =
  | {type: "entity"; join_index: number}
  | {
      type: "component"
      component: ComponentLike
      component_id: number
      store: unknown[] | undefined
      join_index: number
    }
  | {
      type: "has"
      component: ComponentLike
      component_id: number
      join_index: number
    }
  | {
      type: "not"
      component: ComponentLike
      component_id: number
      join_index: number
    }
  | {
      type: "rel"
      relation: Relation
      relation_id: number
      object_term: TermInfo
      join_index: number
      next_join_index: number
    }

export class JoinLevel implements EntityGraphNodeListener {
  readonly nodes: EntityGraphNode[] = []
  readonly nodes_map = make_sparse_map<EntityGraphNode>()
  readonly required_vec: Vec
  readonly excluded_vecs: Vec[]
  readonly join_on?: {readonly id: number}
  readonly anchor_node: EntityGraphNode

  constructor(
    world: World,
    required: ComponentLike[],
    excluded: ComponentLike[],
    join_on?: {readonly id: number},
  ) {
    this.required_vec = make_vec(required, world.component_registry)
    this.excluded_vecs = excluded.map((c) =>
      make_vec([c], world.component_registry),
    )
    this.join_on = join_on

    this.anchor_node = entity_graph_find_or_create_node(
      world.entity_graph,
      this.required_vec,
    )
    entity_graph_node_add_listener(this.anchor_node, this, true)
  }

  node_created(node: EntityGraphNode): void {
    if (!vec_is_superset_of(node.vec, this.required_vec)) {
      return
    }

    for (let i = 0; i < this.excluded_vecs.length; i++) {
      const excluded_vec = this.excluded_vecs[i] as Vec
      if (vec_is_superset_of(node.vec, excluded_vec)) {
        return
      }
    }

    if (!sparse_map_get(this.nodes_map, node.id)) {
      sparse_map_set(this.nodes_map, node.id, node)
      this.nodes.push(node)
    }
  }

  node_destroyed(node: EntityGraphNode): void {
    if (sparse_map_get(this.nodes_map, node.id)) {
      sparse_map_delete(this.nodes_map, node.id)
      const idx = this.nodes.indexOf(node)
      if (idx !== -1) {
        this.nodes.splice(idx, 1)
      }
    }
  }

  teardown(): void {
    entity_graph_node_remove_listener(this.anchor_node, this)
    sparse_map_clear(this.nodes_map)
    this.nodes.length = 0
  }
}

export class AllRuntime implements AnyAll {
  readonly __all = true
  readonly stores: unknown[][] = []
  readonly joins: JoinLevel[] = []
  entity_to_index: {
    readonly sparse: Map<number, number>
    readonly dense: number[]
  } = {sparse: new Map(), dense: []}
  protected _world?: World
  protected _term_infos: TermInfo[] = []

  get nodes() {
    return this.joins[0]?.nodes_map || make_sparse_map<EntityGraphNode>()
  }

  get _anchor_node() {
    return this.joins[0]?.anchor_node
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
    term_idx: number,
    current_result: unknown[],
  ): IterableIterator<unknown[]> {
    if (term_idx === this._term_infos.length) {
      yield [...current_result]
      return
    }

    const info = this._term_infos[term_idx] as TermInfo
    const values = this._get_term_values(entity, info, node)

    for (const val of values) {
      current_result[term_idx] = val
      yield* this._yield_entity(entity, node, term_idx + 1, current_result)
    }
  }

  private _get_term_values(
    entity: Entity,
    info: TermInfo,
    node?: EntityGraphNode,
  ): unknown[] {
    const world = this._world
    assert_defined(world)
    if (info.type === "entity") return [entity]
    if (info.type === "component") {
      const actual_node =
        node ?? sparse_map_get(world.entity_graph.by_entity, entity as number)
      if (!actual_node) return []

      const component_id = info.component_id
      if (!actual_node.vec.sparse.has(component_id)) return []

      if (!info.store) return [undefined]
      const index = sparse_map_get(world.index.entity_to_index, entity)
      if (index === undefined) return []
      const val = info.store[index]
      return val === undefined ? [] : [val]
    }
    if (info.type === "has" || info.type === "not") {
      const actual_node =
        node ?? sparse_map_get(world.entity_graph.by_entity, entity as number)
      if (!actual_node) return info.type === "not" ? [undefined] : []

      const component_id = info.component_id
      const has_component = actual_node.vec.sparse.has(component_id)

      if (info.type === "has") {
        return has_component ? [undefined] : []
      } else {
        return has_component ? [] : [undefined]
      }
    }
    if (info.type === "rel") {
      const nextJoin = this.joins[info.next_join_index]
      if (!nextJoin) return []

      const results: unknown[] = []
      const relation_id = info.relation_id

      for (let i = 0; i < nextJoin.nodes.length; i++) {
        const n = nextJoin.nodes[i] as EntityGraphNode
        const rel_map = n.rel_maps[relation_id]
        if (!rel_map) continue

        const targets = rel_map.subject_to_objects.get(entity as number)
        if (!targets) continue

        const target_entities = targets.dense
        for (let j = 0; j < target_entities.length; j++) {
          const target_entity = target_entities[j] as Entity
          results.push(
            ...this._get_term_values(target_entity, info.object_term, n),
          )
        }
      }
      return results
    }
    return []
  }

  setup(world: World): void {
    this._world = world
    this.entity_to_index = world.index.entity_to_index

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
          joinOn ? {id: world.component_registry.get_id(joinOn)} : undefined,
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
    if (typeof term !== "object" || term === null) {
      throw new Error("Invalid term descriptor")
    }
    const t = term as Record<string, unknown>

    if ("entity" in t) {
      return {type: "entity", join_index: currentJoinIndex}
    }
    if ("rel" in t) {
      const rel_tuple = t.rel as [Relation, unknown]
      const nextJoinIndex = ++context.joinIndex
      return {
        type: "rel",
        relation: rel_tuple[0],
        relation_id: world.component_registry.get_id(rel_tuple[0]),
        object_term: this._resolve_term_info(
          rel_tuple[1],
          world,
          nextJoinIndex,
          context,
        ),
        join_index: currentJoinIndex,
        next_join_index: nextJoinIndex,
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

    if (is_relationship(component)) {
      const vid = get_or_create_virtual_id(
        world,
        component.relation,
        component.object,
      )
      component = world.component_registry.get_virtual_component(vid)
    }

    if (
      component &&
      typeof component === "object" &&
      "component" in (component as Record<string, unknown>)
    ) {
      component = (component as Record<string, unknown>)
        .component as ComponentLike
    }

    const component_id = world.component_registry.get_id(component)

    if (type === "has") {
      return {
        type: "has",
        component,
        component_id,
        join_index: currentJoinIndex,
      }
    }
    if (type === "not") {
      return {
        type: "not",
        component,
        component_id,
        join_index: currentJoinIndex,
      }
    }

    const store = get_component_store(world, component)
    return {
      type: "component",
      component,
      component_id,
      store,
      join_index: currentJoinIndex,
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
      const rel_tuple = t.rel as [Relation, unknown]
      const nextJoinIndex = ++context.joinIndex
      configs.joinOn[nextJoinIndex] = rel_tuple[0]
      this._collect_join_components(
        rel_tuple[1],
        nextJoinIndex,
        configs,
        world,
        context,
      )
      return
    }

    if ("entity" in t) return

    let term_comp: unknown
    let is_excluded = false
    if ("read" in t) {
      term_comp = t.read
    } else if ("write" in t) {
      term_comp = t.write
    } else if ("has" in t) {
      term_comp = t.has
    } else if ("not" in t) {
      term_comp = t.not
      is_excluded = true
    } else {
      term_comp = term
    }

    let component: ComponentLike
    if (is_relationship(term_comp)) {
      const vid = get_or_create_virtual_id(
        world,
        term_comp.relation,
        term_comp.object,
      )
      component = world.component_registry.get_virtual_component(vid)
    } else {
      component = term_comp as ComponentLike
    }

    if (
      component &&
      typeof component === "object" &&
      "component" in (component as Record<string, unknown>)
    ) {
      component = (component as Record<string, unknown>)
        .component as ComponentLike
    }

    const target = is_excluded
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
      this._collect_stores(info.object_term, stores)
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

export function make_all(desc: RawAllDescriptor): AnyAll {
  return new AllRuntime(desc)
}

export function setup_all(all: AnyAll, world: World) {
  if (all instanceof AllRuntime) {
    all.setup(world)
  }
}

export function teardown_all(all: AnyAll) {
  if (all instanceof AllRuntime) {
    all.teardown()
  }
}
