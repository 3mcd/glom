import type {Entity} from "./entity"
import type {EntityGraphNode} from "./entity_graph"
import type {RelationPair, RelationSubject} from "./relation_registry"
import {
  sparse_map_clear,
  sparse_map_for_each,
  sparse_map_get,
  sparse_map_set,
} from "./sparse_map"
import {sparse_set_add, sparse_set_clear, sparse_set_size} from "./sparse_set"
import type {World} from "./world"

export type RegistryDomainSnapshot = {
  readonly hi: number
  readonly entity_id: number
  readonly op_seq: number
  readonly entity_count: number
  readonly dense: number[]
  readonly sparse: Map<number, number>
}

export type Snapshot = {
  readonly tick: number
  readonly tick_spawn_count: number
  readonly component_data: Map<number, unknown[]>
  readonly component_versions: Map<number, Uint32Array>
  readonly entity_archetypes: Int32Array // entity_index -> node_id
  readonly registry_domains: RegistryDomainSnapshot[]
  readonly entity_to_index: Map<number, number>
  readonly index_to_entity: number[]
  readonly free_indices: number[]
  readonly next_index: number
  readonly relations: {
    readonly rel_to_virtual: Map<number, Map<number, number>>
    readonly virtual_to_rel: Map<number, RelationPair>
    readonly object_to_subjects: Map<number, Set<RelationSubject>>
    readonly next_virtual_id: number
  }
}

export type HistoryBuffer = {
  readonly snapshots: Snapshot[]
  max_size: number
}

export function make_history_buffer(max_size = 64): HistoryBuffer {
  return {
    snapshots: [],
    max_size,
  }
}

export function capture_snapshot(world: World): Snapshot {
  const component_data = new Map<number, unknown[]>()
  const next_idx = world.index.next_index

  for (const [id, store] of world.components.storage) {
    if (store.length === 0) continue
    component_data.set(id, store.slice(0, next_idx))
  }

  const component_versions = new Map<number, Uint32Array>()
  for (const [id, versions] of world.components.versions) {
    if (versions.length === 0) continue
    const len = Math.min(versions.length, next_idx)
    const clone = new Uint32Array(len)
    clone.set(versions.subarray(0, len))
    component_versions.set(id, clone)
  }

  const entity_archetypes = new Int32Array(next_idx)

  sparse_map_for_each(world.entity_graph.by_entity, (entity, node) => {
    const idx = sparse_map_get(world.index.entity_to_index, entity)
    if (idx !== undefined) {
      entity_archetypes[idx] = node.id
    }
  })

  const registry_domains: RegistryDomainSnapshot[] = []
  for (let i = 0; i < world.registry.domains.length; i++) {
    const domain = world.registry.domains[i]
    if (domain) {
      registry_domains[i] = {
        hi: domain.hi,
        entity_id: domain.entity_id,
        op_seq: domain.op_seq,
        entity_count: domain.entity_count,
        dense: [...domain.dense],
        sparse: new Map(domain.sparse),
      }
    }
  }

  const entity_to_index = new Map<number, number>()
  sparse_map_for_each(world.index.entity_to_index, (entity, index) => {
    entity_to_index.set(entity, index)
  })

  // Snapshot relations
  const rel_to_virtual = new Map<number, Map<number, number>>()
  for (const [rel_id, obj_map] of world.relations.rel_to_virtual) {
    rel_to_virtual.set(rel_id, new Map(obj_map))
  }

  const virtual_to_rel = new Map<number, RelationPair>()
  for (const [vid, rel_info] of world.relations.virtual_to_rel) {
    virtual_to_rel.set(vid, {...rel_info} as RelationPair)
  }

  const object_to_subjects = new Map<number, Set<RelationSubject>>()
  for (const [obj, subjects] of world.relations.object_to_subjects) {
    const cloned_subjects = new Set<RelationSubject>()
    for (const item of subjects) {
      cloned_subjects.add({...item} as RelationSubject)
    }
    object_to_subjects.set(obj, cloned_subjects)
  }

  return {
    tick: world.tick,
    tick_spawn_count: world.tick_spawn_count,
    component_data,
    component_versions,
    entity_archetypes,
    registry_domains,
    entity_to_index,
    index_to_entity: world.index.index_to_entity.slice(0, next_idx),
    free_indices: [...world.index.free_indices],
    next_index: world.index.next_index,
    relations: {
      rel_to_virtual,
      virtual_to_rel,
      object_to_subjects,
      next_virtual_id: world.component_registry.get_next_virtual_id(),
    },
  }
}

export function rollback_to_snapshot(world: World, snapshot: Snapshot) {
  world.tick = snapshot.tick
  world.tick_spawn_count = snapshot.tick_spawn_count

  // Restore registry state
  for (let i = 0; i < snapshot.registry_domains.length; i++) {
    const s_domain = snapshot.registry_domains[i]
    if (!s_domain) continue

    let domain = world.registry.domains[i]
    if (!domain) {
      domain = {
        hi: s_domain.hi,
        entity_id: s_domain.entity_id,
        op_seq: s_domain.op_seq,
        entity_count: s_domain.entity_count,
        dense: [...s_domain.dense],
        sparse: new Map(s_domain.sparse),
      }
      world.registry.domains[i] = domain
      continue
    }

    domain.entity_id = s_domain.entity_id
    domain.op_seq = s_domain.op_seq
    domain.entity_count = s_domain.entity_count
    domain.dense.length = 0
    domain.dense.push(...s_domain.dense)
    domain.sparse.clear()
    for (const [k, v] of s_domain.sparse) {
      domain.sparse.set(k, v)
    }
  }

  // Restore entity index state
  sparse_map_clear(world.index.entity_to_index)
  for (const [entity, index] of snapshot.entity_to_index) {
    sparse_map_set(world.index.entity_to_index, entity, index)
  }
  world.index.index_to_entity.length = 0
  world.index.index_to_entity.push(...snapshot.index_to_entity)
  world.index.free_indices.length = 0
  world.index.free_indices.push(...snapshot.free_indices)
  world.index.next_index = snapshot.next_index

  // Restore component data IN-PLACE
  for (const [id, current_store] of world.components.storage) {
    if (!snapshot.component_data.has(id)) {
      current_store.length = 0
    }
  }

  for (const [id, store] of snapshot.component_data) {
    let current_store = world.components.storage.get(id)
    if (!current_store) {
      current_store = []
      world.components.storage.set(id, current_store)
    }
    current_store.length = store.length
    for (let i = 0; i < store.length; i++) {
      current_store[i] = store[i]
    }
  }

  // Restore versions IN-PLACE
  for (const [id, current_versions] of world.components.versions) {
    if (!snapshot.component_versions.has(id)) {
      current_versions.fill(0)
    }
  }

  for (const [id, versions] of snapshot.component_versions) {
    const current_versions = world.components.versions.get(id)
    if (!current_versions || current_versions.length < versions.length) {
      world.components.versions.set(id, new Uint32Array(versions))
    } else {
      current_versions.set(versions)
      if (current_versions.length > versions.length) {
        current_versions.fill(0, versions.length)
      }
    }
  }

  // Restore relations
  world.relations.rel_to_virtual.clear()
  for (const [rel_id, obj_map] of snapshot.relations.rel_to_virtual) {
    world.relations.rel_to_virtual.set(rel_id, new Map(obj_map))
  }

  world.relations.virtual_to_rel.clear()
  for (const [vid, rel_info] of snapshot.relations.virtual_to_rel) {
    world.relations.virtual_to_rel.set(vid, {...rel_info})
  }

  world.relations.object_to_subjects.clear()
  for (const [obj, subjects] of snapshot.relations.object_to_subjects) {
    const restored_subjects = new Set<RelationSubject>()
    for (const item of subjects) {
      restored_subjects.add({...item} as RelationSubject)
    }
    world.relations.object_to_subjects.set(obj, restored_subjects)
  }
  world.component_registry.set_next_virtual_id(
    snapshot.relations.next_virtual_id,
  )

  // Restore entity graph state
  for (const node of world.entity_graph.by_hash.values()) {
    if (sparse_set_size(node.entities) > 0) {
      sparse_set_clear(node.entities)
    }
  }

  // Clear pending buffers on rollback
  sparse_map_clear(world.graph_changes)
  world.pending_deletions.clear()
  world.pending_component_removals.clear()

  const nodes_by_id: Map<number, EntityGraphNode> = new Map()
  for (const node of world.entity_graph.by_hash.values()) {
    nodes_by_id.set(node.id, node)
  }

  sparse_map_clear(world.entity_graph.by_entity)
  for (let i = 0; i < snapshot.entity_archetypes.length; i++) {
    const node_id = snapshot.entity_archetypes[i] as number
    if (node_id === 0) continue

    const entity = snapshot.index_to_entity[i] as Entity | undefined
    if (entity === undefined || (entity as unknown as number) === 0) continue

    const node = nodes_by_id.get(node_id)
    if (node) {
      sparse_map_set(
        world.entity_graph.by_entity,
        entity as unknown as number,
        node,
      )
      sparse_set_add(node.entities, entity)
    }
  }
}

export function push_snapshot(world: World, history: HistoryBuffer) {
  const snapshot = capture_snapshot(world)
  history.snapshots.push(snapshot)
  if (history.snapshots.length > history.max_size) {
    history.snapshots.shift()
  }
}

export function rollback_to_tick(
  world: World,
  history: HistoryBuffer,
  tick: number,
): boolean {
  const snapshot = history.snapshots.find((s) => s.tick === tick)
  if (!snapshot) return false
  rollback_to_snapshot(world, snapshot)
  // Prune future snapshots
  const index = history.snapshots.indexOf(snapshot)
  history.snapshots.length = index + 1
  return true
}
