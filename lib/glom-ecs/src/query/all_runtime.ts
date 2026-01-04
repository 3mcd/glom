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
  | {type: "entity"}
  | {
      type: "component"
      component: ComponentLike
      component_id: number
      store: unknown[] | undefined
    }
  | {type: "has"; component: ComponentLike; component_id: number}
  | {type: "not"; component: ComponentLike; component_id: number}
  | {
      type: "rel"
      relation: Relation
      relation_id: number
      object_term: TermInfo
    }

export class AllRuntime implements AnyAll, EntityGraphNodeListener {
  readonly __all = true
  readonly nodes = make_sparse_map<EntityGraphNode>()
  protected _anchor_node?: EntityGraphNode
  protected _world?: World
  protected _required_vec?: Vec
  protected _excluded_vecs: Vec[] = []
  protected _term_infos: TermInfo[] = []

  constructor(readonly desc: RawAllDescriptor) {}

  *[Symbol.iterator](): Iterator<unknown[]> {
    const nodes = this.nodes.dense

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
      const actual_node =
        node ?? sparse_map_get(world.entity_graph.by_entity, entity as number)
      if (!actual_node) return []

      const objects = this._get_rel_objects(
        entity,
        actual_node,
        info.relation_id,
      )
      const results: unknown[] = []
      for (let i = 0; i < objects.length; i++) {
        const object = objects[i] as Entity
        results.push(...this._get_term_values(object, info.object_term))
      }
      return results
    }
    return []
  }

  protected _get_rel_objects(
    _entity: Entity,
    node: EntityGraphNode,
    relation_id: number,
  ): Entity[] {
    const world = this._world
    assert_defined(world)
    const objects: Entity[] = []

    const elements = node.vec.elements
    for (let i = 0; i < elements.length; i++) {
      const comp = elements[i] as ComponentLike
      const comp_id = world.component_registry.get_id(comp)
      const rel_info = world.relations.virtual_to_rel.get(comp_id)
      if (rel_info && rel_info.relation_id === relation_id) {
        objects.push(rel_info.object as Entity)
      }
    }
    return objects
  }

  node_created(node: EntityGraphNode): void {
    if (this._required_vec) {
      if (!vec_is_superset_of(node.vec, this._required_vec)) {
        return
      }
    }

    for (let i = 0; i < this._excluded_vecs.length; i++) {
      const excluded_vec = this._excluded_vecs[i] as Vec
      if (vec_is_superset_of(node.vec, excluded_vec)) {
        return
      }
    }

    sparse_map_set(this.nodes, node.id, node)
  }

  node_destroyed(node: EntityGraphNode): void {
    sparse_map_delete(this.nodes, node.id)
  }

  setup(world: World): void {
    this._world = world

    // Resolve terms once
    this._term_infos = this.desc.all.map((term: unknown) =>
      this._resolve_term_info(term, world),
    )

    const {required, excluded} = collect_components(this.desc, world)
    this._required_vec = make_vec(required, world.component_registry)
    this._excluded_vecs = excluded.map((c) =>
      make_vec([c], world.component_registry),
    )

    this._anchor_node = entity_graph_find_or_create_node(
      world.entity_graph,
      this._required_vec,
    )
    entity_graph_node_add_listener(this._anchor_node, this, true)
  }

  private _resolve_term_info(term: unknown, world: World): TermInfo {
    if (typeof term !== "object" || term === null) {
      throw new Error("Invalid term descriptor")
    }
    const t = term as Record<string, unknown>

    if ("entity" in t) {
      return {type: "entity"}
    }
    if ("rel" in t) {
      const rel_tuple = t.rel as [Relation, unknown]
      return {
        type: "rel",
        relation: rel_tuple[0],
        relation_id: world.component_registry.get_id(rel_tuple[0]),
        object_term: this._resolve_term_info(rel_tuple[1], world),
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
      return {type: "has", component, component_id}
    }
    if (type === "not") {
      return {type: "not", component, component_id}
    }

    const store = get_component_store(world, component)
    return {
      type: "component",
      component,
      component_id,
      store,
    }
  }

  teardown(): void {
    if (this._anchor_node) {
      entity_graph_node_remove_listener(this._anchor_node, this)
      this._anchor_node = undefined
    }
    this._world = undefined
    this._required_vec = undefined
    this._excluded_vecs = []
    this._term_infos = []
    sparse_map_clear(this.nodes)
  }
}

export function make_all(desc: RawAllDescriptor): AnyAll {
  return new AllRuntime(desc)
}

function collect_components(
  desc: RawAllDescriptor,
  world: World,
): {required: ComponentLike[]; excluded: ComponentLike[]} {
  const required: ComponentLike[] = []
  const excluded: ComponentLike[] = []
  for (let i = 0; i < desc.all.length; i++) {
    const term = desc.all[i] as unknown
    add_term_components(term, required, excluded, world)
  }
  return {required, excluded}
}

function add_term_components(
  term: unknown,
  required: ComponentLike[],
  excluded: ComponentLike[],
  world: World,
) {
  if (typeof term !== "object" || term === null) return
  const t = term as Record<string, unknown>

  if ("rel" in t) {
    const rel_tuple = t.rel as [Relation, unknown]
    required.push(rel_tuple[0])
    return
  }
  if ("entity" in t) {
    return
  }

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

  const target = is_excluded ? excluded : required

  if (
    component &&
    (typeof component === "object" || typeof component === "function") &&
    ("__component_brand" in component ||
      "id" in (component as Record<string, unknown>))
  ) {
    target.push(component)
  }
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
