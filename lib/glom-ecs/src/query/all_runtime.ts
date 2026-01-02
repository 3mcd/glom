import type { Component } from "../component"
import {
  type EntityGraphNode,
  type EntityGraphNodeListener,
  entity_graph_find_or_create_node,
  entity_graph_node_add_listener,
  entity_graph_node_remove_listener,
} from "../entity_graph"
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

  constructor(
    readonly desc: AllDescriptor<any, any, any, any, any, any, any, any>,
  ) {}

  *[Symbol.iterator](): Iterator<any> {
    const world = this._world
    if (!world) {
      return
    }

    const termInfos = this.desc.all.map((term) => {
      if ("entity" in term) {
        return { type: "entity" as const }
      }
      const component =
        "read" in term ? (term as any).read : (term as any).write
      return {
        type: "component" as const,
        component,
        store: get_component_store(world, component),
      }
    })

    const nodes = this.nodes.dense

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!
      const entities = node.entities.dense
      for (let j = 0; j < entities.length; j++) {
        const entity = entities[j]!
        const index = sparse_map_get(world.entity_to_index, entity)!

        const result = new Array(termInfos.length)

        for (let k = 0; k < termInfos.length; k++) {
          const info = termInfos[k]!
          if (info.type === "entity") {
            result[k] = entity
          } else if (info.type === "component") {
            result[k] = info.store ? info.store[index] : undefined
          }
        }

        yield result
      }
    }
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
    const components = collect_components(this.desc)
    this._required_vec = make_vec(components)

    this._anchor_node = entity_graph_find_or_create_node(
      world.entity_graph,
      this._required_vec,
    )
    entity_graph_node_add_listener(this._anchor_node, this, true)
  }

  teardown(): void {
    if (this._anchor_node) {
      entity_graph_node_remove_listener(this._anchor_node, this)
      this._anchor_node = undefined
    }
    this._world = undefined
    this._required_vec = undefined
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
): Component<unknown>[] {
  const components: Component<unknown>[] = []
  for (let i = 0; i < desc.all.length; i++) {
    const term = desc.all[i]!
    if ("read" in term) {
      components.push(term.read)
    } else if ("write" in term) {
      components.push(term.write)
    }
  }
  return components
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
