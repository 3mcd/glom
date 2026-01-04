import type {InDescriptor, OutDescriptor} from "../descriptors"
import type {Entity} from "../entity"
import type {EntityGraphNode} from "../entity_graph"
import {sparse_map_get, sparse_map_has} from "../sparse_map"
import {
  make_sparse_set,
  sparse_set_add,
  sparse_set_clear,
  sparse_set_delete,
  sparse_set_values,
} from "../sparse_set"
import {AllRuntime, type TermInfo} from "./all_runtime"

type MonitorMode = "in" | "out"

export class MonitorRuntime extends AllRuntime {
  readonly added = make_sparse_set<Entity>()
  readonly removed = make_sparse_set<Entity>()
  private _mode: MonitorMode

  constructor(desc: InDescriptor | OutDescriptor, mode: MonitorMode) {
    super(
      mode === "in" ? (desc as InDescriptor).in : (desc as OutDescriptor).out,
    )
    this._mode = mode
  }

  entities_in(entities: Entity[], node: EntityGraphNode): void {
    if (sparse_map_has(this.nodes, node.id)) {
      for (let i = 0; i < entities.length; i++) {
        const e = entities[i]!
        sparse_set_add(this.added, e)
        sparse_set_delete(this.removed, e)
      }
    }
  }

  entities_out(entities: Entity[], node: EntityGraphNode): void {
    if (sparse_map_has(this.nodes, node.id)) {
      for (let i = 0; i < entities.length; i++) {
        const e = entities[i]!
        sparse_set_add(this.removed, e)
        sparse_set_delete(this.added, e)
      }
    }
  }

  override *[Symbol.iterator](): Iterator<unknown[]> {
    const world = this._world
    if (!world) return

    // Refresh store references to handle rollback/snapshot replacements
    const refresh_stores = (infos: TermInfo[]) => {
      for (let i = 0; i < infos.length; i++) {
        const info = infos[i]!
        if (info.type === "component") {
          info.store = world.components.storage.get(info.component_id)
        } else if (info.type === "rel") {
          refresh_stores([info.object_term])
        }
      }
    }
    refresh_stores(this._term_infos)

    const targets = this._mode === "in" ? this.added : this.removed
    const entities = sparse_set_values(targets)

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]!
      // For monitors, we bypass the node-matching check in the iterator
      // because the entity is either just entering or just leaving.
      yield* this._yield_entity_monitor(
        entity,
        0,
        new Array(this._term_infos.length),
      )
    }
  }

  private *_yield_entity_monitor(
    entity: Entity,
    term_idx: number,
    current_result: unknown[],
  ): IterableIterator<unknown[]> {
    const term_infos = this._term_infos
    if (term_idx === term_infos.length) {
      yield [...current_result]
      return
    }

    const info = term_infos[term_idx]
    if (!info) return

    const values = this._get_term_values_monitor(entity, info)

    for (let i = 0; i < values.length; i++) {
      const val = values[i]
      current_result[term_idx] = val
      yield* this._yield_entity_monitor(entity, term_idx + 1, current_result)
    }
  }

  private _get_term_values_monitor(entity: Entity, info: TermInfo): unknown[] {
    if (info.type === "entity") return [entity]
    if (info.type === "component") {
      const world = this._world
      if (!world) return []
      if (!info.store) return [undefined]
      const index = sparse_map_get(
        world.index.entity_to_index,
        entity as number,
      )
      if (index === undefined) return []
      const val = info.store[index]
      return val === undefined ? [] : [val]
    }
    if (info.type === "has" || info.type === "not") {
      const world = this._world
      if (!world) return []
      const node = sparse_map_get(
        world.entity_graph.by_entity,
        entity as number,
      )
      const has_component = node
        ? node.vec.sparse.has(info.component_id)
        : false
      if (info.type === "has") {
        return has_component ? [undefined] : []
      } else {
        return has_component ? [] : [undefined]
      }
    }
    if (info.type === "rel") {
      const world = this._world
      if (!world) return []
      const node = sparse_map_get(
        world.entity_graph.by_entity,
        entity as number,
      )
      if (!node) return []

      const objects = this._get_rel_objects(entity, node, info.relation_id)
      const results: unknown[] = []
      for (let i = 0; i < objects.length; i++) {
        const object = objects[i]!
        results.push(...this._get_term_values_monitor(object, info.object_term))
      }
      return results
    }
    return []
  }

  clear() {
    sparse_set_clear(this.added)
    sparse_set_clear(this.removed)
  }
}

export function make_in(desc: InDescriptor) {
  return new MonitorRuntime(desc, "in")
}

export function make_out(desc: OutDescriptor) {
  return new MonitorRuntime(desc, "out")
}
