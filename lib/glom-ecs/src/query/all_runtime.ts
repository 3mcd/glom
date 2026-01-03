import type { Component } from "../component"
import {
  type EntityGraphNode,
  type EntityGraphNodeListener,
  entity_graph_find_or_create_node,
  entity_graph_node_add_listener,
  entity_graph_node_remove_listener,
} from "../entity_graph"
import { type Relationship, is_relationship_instance } from "../relation"
import {
  get_or_create_virtual_id,
  get_virtual_component,
} from "../relation_registry"
import {
  make_sparse_map,
  sparse_map_clear,
  sparse_map_delete,
  sparse_map_get,
  sparse_map_set,
} from "../sparse_map"
import type { AllDescriptor } from "../system_descriptor"
import { make_vec, type Vec, vec_is_superset_of } from "../vec"
import { get_component_store, type World } from "../world"
import type { All } from "./all"
import type { Entity } from "../entity"

type TermInfo =
  | { type: "entity" }
  | { type: "component"; store: any[] }
  | { type: "rel"; relationship: Relationship; target_term: TermInfo }

export class AllRuntime
  implements
    All<any, any, any, any, any, any, any, any>,
    EntityGraphNodeListener
{
  readonly __all = true
  readonly nodes = make_sparse_map<EntityGraphNode>()
  private _anchor_node?: EntityGraphNode
  private _world?: World
  private _required_vec?: Vec
  private _term_infos: TermInfo[] = []

  constructor(
    readonly desc: AllDescriptor<any, any, any, any, any, any, any, any>,
  ) {}

  *[Symbol.iterator](): Iterator<any> {
    const world = this._world
    if (!world) {
      return
    }

    const nodes = this.nodes.dense

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!
      const entities = node.entities.dense
      for (let j = 0; j < entities.length; j++) {
        const entity = entities[j]!
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
    current_result: any[],
  ): IterableIterator<any[]> {
    if (term_idx === this._term_infos.length) {
      yield [...current_result]
      return
    }

    const info = this._term_infos[term_idx]!
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
  ): any[] {
    if (info.type === "entity") return [entity]
    if (info.type === "component") {
      if (!info.store) return [undefined]
      const index = sparse_map_get(this._world!.index.entity_to_index, entity)
      if (index === undefined) return []
      const val = info.store[index]
      return val === undefined ? [] : [val]
    }
    if (info.type === "rel") {
      const world = this._world!
      const actual_node =
        node ?? world.entity_graph.by_entity[entity as number]
      if (!actual_node) return []

      const targets = this._get_rel_targets(entity, actual_node, info.relationship)
      const results: any[] = []
      for (const target of targets) {
        results.push(...this._get_term_values(target, info.target_term))
      }
      return results
    }
    return []
  }

  private _get_rel_targets(
    _entity: Entity,
    node: EntityGraphNode,
    relationship: Relationship,
  ): Entity[] {
    const world = this._world!
    const targets: Entity[] = []
    const rel_id = relationship.id

    for (const comp of node.vec.elements) {
      const rel_info = world.relations.virtual_to_relation.get(comp.id)
      if (rel_info && rel_info.rel_id === rel_id) {
        targets.push(rel_info.target as Entity)
      }
    }
    return targets
  }

  node_created(node: EntityGraphNode): void {
    if (
      this._required_vec &&
      !vec_is_superset_of(node.vec, this._required_vec)
    ) {
      return
    }

    sparse_map_set(this.nodes, node.id, node)
  }

  node_destroyed(node: EntityGraphNode): void {
    sparse_map_delete(this.nodes, node.id)
  }

  setup(world: World): void {
    this._world = world

    // Resolve terms once
    this._term_infos = this.desc.all.map((term) =>
      this._resolve_term_info(term, world),
    )

    const components = collect_components(this.desc, world)
    this._required_vec = make_vec(components)

    this._anchor_node = entity_graph_find_or_create_node(
      world.entity_graph,
      this._required_vec,
    )
    entity_graph_node_add_listener(this._anchor_node, this, true)
  }

  private _resolve_term_info(term: any, world: World): TermInfo {
    if ("entity" in term) {
      return { type: "entity" }
    }
    if ("rel" in term) {
      const [rel, target_desc] = term.rel
      return {
        type: "rel",
        relationship: rel,
        target_term: this._resolve_term_info(target_desc, world),
      }
    }
    let component: any
    if ("read" in term) {
      component = term.read
    } else if ("write" in term) {
      component = term.write
    } else {
      component = term
    }

    if (is_relationship_instance(component)) {
      const vid = get_or_create_virtual_id(
        world,
        component.relationship,
        component.target,
      )
      component = get_virtual_component(world.relations, vid)
    }

    return {
      type: "component",
      store: get_component_store(world, component),
    }
  }

  teardown(): void {
    if (this._anchor_node) {
      entity_graph_node_remove_listener(this._anchor_node, this)
      this._anchor_node = undefined
    }
    this._world = undefined
    this._required_vec = undefined
    this._term_infos = []
    sparse_map_clear(this.nodes)
  }
}

export function make_all(
  desc: AllDescriptor<any, any, any, any, any, any, any, any>,
): All {
  return new AllRuntime(desc) as any
}

function collect_components(
  desc: AllDescriptor<any, any, any, any, any, any, any, any>,
  world: World,
): Component<unknown>[] {
  const components: Component<unknown>[] = []
  for (let i = 0; i < desc.all.length; i++) {
    const term = desc.all[i]!
    add_term_components(term, components, world)
  }
  return components
}

function add_term_components(
  term: any,
  components: Component<any>[],
  world: World,
) {
  if ("rel" in term) {
    components.push(term.rel[0])
    return
  }
  if ("entity" in term) {
    return
  }

  let component: any
  if ("read" in term) {
    component = term.read
  } else if ("write" in term) {
    component = term.write
  } else {
    component = term
  }

  if (is_relationship_instance(component)) {
    const vid = get_or_create_virtual_id(
      world,
      component.relationship,
      component.target,
    )
    components.push(get_virtual_component(world.relations, vid))
  } else if (
    component &&
    (typeof component === "object" || typeof component === "function") &&
    "id" in component
  ) {
    components.push(component)
  }
}

export function setup_all(all: All, world: World) {
  if (all instanceof AllRuntime) {
    all.setup(world)
  }
}

export function teardown_all(all: All) {
  if (all instanceof AllRuntime) {
    all.teardown()
  }
}
