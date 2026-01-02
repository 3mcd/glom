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
import { make_vec } from "../vec"
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

  constructor(
    readonly desc: AllDescriptor<any, any, any, any, any, any, any, any>,
  ) {}

  *[Symbol.iterator](): Iterator<any> {
    const world = this._world
    if (!world) {
      return
    }

    const stores = this.desc.all.map((term) => {
      if ("entity" in term) {
        return null
      }
      const component = "read" in term ? term.read : term.write
      return get_component_store(world, component)
    })

    const nodes = this.nodes.dense

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!
      const entities = node.entities.dense
      for (let j = 0; j < entities.length; j++) {
        const entity = entities[j]!
        const index = sparse_map_get(world.entity_to_index, entity)!
        const values = new Array(stores.length)
        for (let k = 0; k < stores.length; k++) {
          const store = stores[k]
          if (store === null) {
            values[k] = entity
          } else {
            values[k] = store[index]
          }
        }
        yield values
      }
    }
  }

  node_created(node: EntityGraphNode): void {
    sparse_map_set(this.nodes, node.id, node)
  }

  node_destroyed(node: EntityGraphNode): void {
    sparse_map_delete(this.nodes, node.id)
  }

  setup(world: World): void {
    this._world = world
    const vec = make_vec(collect_components(this.desc))
    this._anchor_node = entity_graph_find_or_create_node(
      world.entity_graph,
      vec,
    )
    entity_graph_node_add_listener(this._anchor_node, this, true)
  }

  teardown(): void {
    if (this._anchor_node) {
      entity_graph_node_remove_listener(this._anchor_node, this)
      this._anchor_node = undefined
    }
    this._world = undefined
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
