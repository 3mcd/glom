import {
  type Component,
  type ComponentInstance,
  type ComponentLike,
  define_tag,
} from "./component"
import { type Entity, get_hi } from "./entity"
import {
  create_entity_batch_key,
  type EntityGraphBatch,
  type EntityGraphNode,
  emit_despawned_entities,
  emit_moved_entities,
  emit_spawned_entities,
  entity_graph_batch_add,
  entity_graph_find_or_create_node,
  entity_graph_get_entity_node,
  entity_graph_node_prune,
  entity_graph_node_remove_entity,
  entity_graph_set_entity_node,
  PruneStrategy,
  pool_get_batch,
  pool_return_batch,
} from "./entity_graph"
import {
  alloc_entity,
  get_domain,
  next_op_seq,
  remove_entity,
} from "./entity_registry"
import { add_domain_entity } from "./entity_registry_domain"
import { push_snapshot } from "./history"
import { is_relationship } from "./relation"
import {
  get_or_create_virtual_id,
  get_virtual_id,
  register_incoming_relation,
  unregister_incoming_relation,
} from "./relation_registry"
import {
  make_causal_key,
  pool_get_op,
  pool_return_op,
  Replicated,
  type ReplicationOp,
  TRANSIENT_DOMAIN,
} from "./replication"
import {
  sparse_map_clear,
  sparse_map_delete,
  sparse_map_for_each,
  sparse_map_get,
  sparse_map_set,
} from "./sparse_map"
import { sparse_set_delete, sparse_set_size } from "./sparse_set"
import { make_vec, vec_difference, vec_sum } from "./vec"
import {
  delete_component_value,
  type GraphMove,
  get_component_value,
  set_component_value,
  type World,
} from "./world"

function record_graph_move(
  world: World<any>,
  entity: Entity,
  prev_node: EntityGraphNode | undefined,
  next_node: EntityGraphNode | undefined,
) {
  if (prev_node) {
    world.pending_node_pruning.add(prev_node)
  }
  let move = sparse_map_get(world.graph_changes, entity as number)
  if (!move) {
    move = { entity, from: prev_node, to: next_node }
    sparse_map_set(world.graph_changes, entity as number, move)
  } else {
    move.to = next_node
  }
}

export function spawn(
  world: World<any>,
  components: (ComponentInstance<unknown> | ComponentLike)[],
  hi = world.registry.hi,
  intent_tick = world.tick,
): Entity {
  let is_replicated = false
  for (let i = 0; i < components.length; i++) {
    const c = components[i]
    if (c && typeof c === "object" && "component" in c) {
      if (
        world.component_registry.get_id(
          (c as ComponentInstance<unknown>).component,
        ) === Replicated.id
      ) {
        is_replicated = true
        break
      }
    } else if (c && !is_relationship(c)) {
      if (
        world.component_registry.get_id(c as ComponentLike) === Replicated.id
      ) {
        is_replicated = true
        break
      }
    }
  }

  const causal_tick = intent_tick
  const causal_index = is_replicated ? world.tick_spawn_count++ : 0x7fff
  const causal_key = make_causal_key(causal_tick, causal_index)

  let entity: Entity
  const existing = world.transient_registry.get(causal_key)
  if (existing) {
    entity = existing.entity
    add_domain_entity(get_domain(world.registry, get_hi(entity)), entity)
  } else {
    const is_prediction = !!world.history
    const actual_hi = is_prediction ? TRANSIENT_DOMAIN : hi
    entity = alloc_entity(world.registry, actual_hi)
  }

  const resolved_components: ComponentLike[] = []

  for (let i = 0; i < components.length; i++) {
    const item = components[i]
    if (item && typeof item === "object" && "component" in item) {
      const inst = item as ComponentInstance<unknown>
      resolved_components.push(inst.component)
      set_component_value(
        world,
        entity,
        inst.component as Component<unknown>,
        inst.value,
      )
    } else if (item) {
      if (is_relationship(item)) {
        const vid = get_or_create_virtual_id(world, item.relation, item.object)
        resolved_components.push(
          world.component_registry.get_virtual_component(vid),
        )
        resolved_components.push(item.relation)
        register_incoming_relation(
          world,
          entity,
          world.component_registry.get_id(item.relation),
          item.object,
        )
      } else {
        resolved_components.push(item)
      }
    }
  }

  if (get_hi(entity) === TRANSIENT_DOMAIN) {
    world.transient_registry.set(causal_key, {
      entity,
      tick: world.tick,
    })
  }

  if (world.recorder && hi === world.registry.hi) {
    let replicated_check = false
    for (let i = 0; i < resolved_components.length; i++) {
      if (
        world.component_registry.get_id(resolved_components[i]!) ===
        Replicated.id
      ) {
        replicated_check = true
        break
      }
    }
    if (replicated_check) {
      const op = pool_get_op("spawn")
      op.entity = entity
      op.causal_key = causal_key
      op.components = []
      for (let i = 0; i < resolved_components.length; i++) {
        const c = resolved_components[i]!
        const id = world.component_registry.get_id(c)
        op.components.push({
          id,
          data: get_component_value(world, entity, c),
          rel: world.relations.virtual_to_rel.get(id),
        })
      }
      world.pending_ops.push(op)
    }
  }

  const vec = make_vec(resolved_components, world.component_registry)
  const node = entity_graph_find_or_create_node(world.entity_graph, vec)
  const prev_node = entity_graph_set_entity_node(
    world.entity_graph,
    entity,
    node,
  )

  record_graph_move(world, entity, prev_node, node)

  return entity
}

export function despawn(world: World<any>, entity: Entity): void {
  const node = entity_graph_get_entity_node(world.entity_graph, entity)
  if (!node) {
    return
  }

  const hi = world.registry.hi
  if (world.recorder && get_hi(entity) === hi) {
    let is_replicated = false
    const elements = node.vec.elements
    for (let i = 0; i < elements.length; i++) {
      if (world.component_registry.get_id(elements[i]!) === Replicated.id) {
        is_replicated = true
        break
      }
    }
    if (is_replicated) {
      const op = pool_get_op("despawn")
      op.entity = entity
      world.pending_ops.push(op)
    }
  }

  const incoming = world.relations.object_to_subjects.get(entity)
  if (incoming) {
    const to_remove = Array.from(incoming)
    for (let i = 0; i < to_remove.length; i++) {
      const { subject, relation_id } = to_remove[i]!
      remove_relation(world, subject as Entity, relation_id, entity)
    }
  }

  const elements = node.vec.elements
  for (let i = 0; i < elements.length; i++) {
    const comp = elements[i]!
    const comp_id = world.component_registry.get_id(comp)
    const rel = world.relations.virtual_to_rel.get(comp_id)
    if (rel) {
      unregister_incoming_relation(
        world,
        entity,
        rel.relation_id,
        rel.object as Entity,
      )
    }
  }

  world.pending_deletions.add(entity)

  const prev_node = sparse_map_get(
    world.entity_graph.by_entity,
    entity as number,
  )
  if (prev_node) {
    entity_graph_node_remove_entity(prev_node, entity)
    sparse_map_delete(world.entity_graph.by_entity, entity as number)
    record_graph_move(world, entity, prev_node, undefined)
  }
}

function remove_relation(
  world: World<any>,
  entity: Entity,
  relation_id: number,
  object: Entity,
): void {
  const node = entity_graph_get_entity_node(world.entity_graph, entity)
  if (!node) return

  const virtual_id = get_virtual_id(world.relations, relation_id, object)
  if (virtual_id === undefined) return

  const vid_comp = world.component_registry.get_virtual_component(virtual_id)
  let next_vec = vec_difference(
    node.vec,
    make_vec([vid_comp as Component<unknown>], world.component_registry),
    world.component_registry,
  )

  let has_other_relations = false
  const elements = next_vec.elements
  for (let i = 0; i < elements.length; i++) {
    const comp = elements[i]!
    const rel = world.relations.virtual_to_rel.get(
      world.component_registry.get_id(comp),
    )
    if (rel && rel.relation_id === relation_id) {
      has_other_relations = true
      break
    }
  }

  if (!has_other_relations) {
    const rel_tag = world.component_registry.get_component(relation_id)
    if (rel_tag) {
      next_vec = vec_difference(
        next_vec,
        make_vec([rel_tag], world.component_registry),
        world.component_registry,
      )
    }
  }

  const next_node = entity_graph_find_or_create_node(
    world.entity_graph,
    next_vec,
  )
  const prev_node = entity_graph_set_entity_node(
    world.entity_graph,
    entity,
    next_node,
  )
  record_graph_move(world, entity, prev_node, next_node)
}

export function add_component(
  world: World<any>,
  entity: Entity,
  item: ComponentInstance<unknown> | ComponentLike,
): void {
  const node = entity_graph_get_entity_node(world.entity_graph, entity)
  if (!node) return

  const to_add: ComponentLike[] = []
  if (item && typeof item === "object" && "component" in item) {
    const inst = item as ComponentInstance<unknown>
    to_add.push(inst.component)
    set_component_value(
      world,
      entity,
      inst.component as Component<unknown>,
      inst.value,
    )
  } else if (item) {
    if (is_relationship(item)) {
      const vid = get_or_create_virtual_id(world, item.relation, item.object)
      to_add.push(world.component_registry.get_virtual_component(vid))
      to_add.push(item.relation)
      register_incoming_relation(
        world,
        entity,
        world.component_registry.get_id(item.relation),
        item.object,
      )
    } else {
      to_add.push(item)
    }
  }

  if (to_add.length > 0) {
    if (world.recorder && get_hi(entity) === world.registry.hi) {
      let already_replicated = false
      const elements = node.vec.elements
      for (let i = 0; i < elements.length; i++) {
        if (world.component_registry.get_id(elements[i]!) === Replicated.id) {
          already_replicated = true
          break
        }
      }

      let adding_replicated = false
      for (let i = 0; i < to_add.length; i++) {
        if (world.component_registry.get_id(to_add[i]!) === Replicated.id) {
          adding_replicated = true
          break
        }
      }

      if (already_replicated) {
        for (let i = 0; i < to_add.length; i++) {
          const c = to_add[i]!
          const id = world.component_registry.get_id(c)
          const op = pool_get_op("set")
          op.entity = entity
          op.component_id = id
          op.data = get_component_value(world, entity, c)
          op.rel = world.relations.virtual_to_rel.get(id)
          world.pending_ops.push(op)
        }
      } else if (adding_replicated) {
        const all_components = [...node.vec.elements, ...to_add]
        const op = pool_get_op("spawn")
        op.entity = entity
        op.causal_key = make_causal_key(world.tick, world.tick_spawn_count++)
        op.components = []
        for (let i = 0; i < all_components.length; i++) {
          const c = all_components[i]!
          const id = world.component_registry.get_id(c)
          op.components.push({
            id,
            data: get_component_value(world, entity, c),
            rel: world.relations.virtual_to_rel.get(id),
          })
        }
        world.pending_ops.push(op)
      }
    }

    const next_vec = vec_sum(
      node.vec,
      make_vec(to_add, world.component_registry),
      world.component_registry,
    )
    const next_node = entity_graph_find_or_create_node(
      world.entity_graph,
      next_vec,
    )
    const prev_node = entity_graph_set_entity_node(
      world.entity_graph,
      entity,
      next_node,
    )
    record_graph_move(world, entity, prev_node, next_node)
  }
}

export function remove_component(
  world: World<any>,
  entity: Entity,
  item: ComponentLike,
): void {
  const node = entity_graph_get_entity_node(world.entity_graph, entity)
  if (!node) return

  const to_remove: ComponentLike[] = []
  if (is_relationship(item)) {
    const virtual_id = get_virtual_id(
      world.relations,
      world.component_registry.get_id(item.relation),
      item.object,
    )
    if (virtual_id !== undefined) {
      const vid_comp =
        world.component_registry.get_virtual_component(virtual_id)
      to_remove.push(vid_comp)
      unregister_incoming_relation(
        world,
        entity,
        world.component_registry.get_id(item.relation),
        item.object,
      )

      let has_other_relations = false
      const elements = node.vec.elements
      for (let i = 0; i < elements.length; i++) {
        const comp = elements[i]!
        if (
          world.component_registry.get_id(comp) ===
          world.component_registry.get_id(vid_comp)
        )
          continue
        const rel = world.relations.virtual_to_rel.get(
          world.component_registry.get_id(comp),
        )
        if (
          rel &&
          rel.relation_id === world.component_registry.get_id(item.relation)
        ) {
          has_other_relations = true
          break
        }
      }

      if (!has_other_relations) {
        to_remove.push(item.relation)
      }
    }
  } else {
    to_remove.push(item)
  }

  if (to_remove.length > 0) {
    if (world.recorder && get_hi(entity) === world.registry.hi) {
      let is_replicated = false
      const elements = node.vec.elements
      for (let i = 0; i < elements.length; i++) {
        if (world.component_registry.get_id(elements[i]!) === Replicated.id) {
          is_replicated = true
          break
        }
      }
      if (is_replicated) {
        for (let i = 0; i < to_remove.length; i++) {
          const c = to_remove[i]!
          const op = pool_get_op("remove")
          op.entity = entity
          op.component_id = world.component_registry.get_id(c)
          world.pending_ops.push(op)
        }
      }
    }

    for (let i = 0; i < to_remove.length; i++) {
      const c = to_remove[i]!
      if (!c.is_tag) {
        let list = world.pending_component_removals.get(entity)
        if (!list) {
          list = []
          world.pending_component_removals.set(entity, list)
        }
        list.push(c)
      }
    }

    const next_vec = vec_difference(
      node.vec,
      make_vec(to_remove, world.component_registry),
      world.component_registry,
    )
    const next_node = entity_graph_find_or_create_node(
      world.entity_graph,
      next_vec,
    )
    const prev_node = entity_graph_set_entity_node(
      world.entity_graph,
      entity,
      next_node,
    )
    record_graph_move(world, entity, prev_node, next_node)
  }
}

export function commit_transaction(world: World<any>): void {
  if (!world.recorder || world.pending_ops.length === 0) {
    for (let i = 0; i < world.pending_ops.length; i++) {
      pool_return_op(world.pending_ops[i]!)
    }
    world.pending_ops.length = 0
    return
  }

  const hi = world.registry.hi
  const reduced_ops: ReplicationOp[] = []
  const entity_to_ops = world._reduction_entity_to_ops
  entity_to_ops.clear()

  for (let i = 0; i < world.pending_ops.length; i++) {
    const op = world.pending_ops[i]!
    let list = entity_to_ops.get(op.entity)
    if (!list) {
      list = []
      entity_to_ops.set(op.entity, list)
    }
    list.push(op)
  }

  const entities = Array.from(entity_to_ops.keys())
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]!
    const ops = entity_to_ops.get(entity)!

    let was_spawned = false
    for (let j = 0; j < ops.length; j++) {
      if (ops[j]!.type === "spawn") {
        was_spawned = true
        break
      }
    }
    const is_dead = world.pending_deletions.has(entity)
    if (was_spawned && is_dead) continue

    if (is_dead) {
      const op = pool_get_op("despawn")
      op.entity = entity
      reduced_ops.push(op)
      continue
    }

    if (was_spawned) {
      const node = entity_graph_get_entity_node(world.entity_graph, entity)
      if (!node) continue

      let spawn_op_orig: Extract<ReplicationOp, { type: "spawn" }> | undefined
      for (let j = 0; j < ops.length; j++) {
        if (ops[j]!.type === "spawn") {
          spawn_op_orig = ops[j] as Extract<ReplicationOp, { type: "spawn" }>
          break
        }
      }
      if (!spawn_op_orig) continue

      const op = pool_get_op("spawn")
      op.entity = entity
      op.causal_key = spawn_op_orig.causal_key
      op.components = []
      const elements = node.vec.elements
      for (let j = 0; j < elements.length; j++) {
        const c = elements[j]!
        const id = world.component_registry.get_id(c)
        op.components.push({
          id,
          data: get_component_value(world, entity, c),
          rel: world.relations.virtual_to_rel.get(id),
        })
      }
      reduced_ops.push(op)
      continue
    }

    const component_changes = world._reduction_component_changes
    const component_removals = world._reduction_component_removals
    component_changes.clear()
    component_removals.clear()

    for (let j = 0; j < ops.length; j++) {
      const op = ops[j]!
      if (op.type === "set") {
        component_changes.set(op.component_id, op)
        component_removals.delete(op.component_id)
      } else if (op.type === "remove") {
        component_removals.add(op.component_id)
        component_changes.delete(op.component_id)
      }
    }

    const change_ops = Array.from(component_changes.values())
    for (let j = 0; j < change_ops.length; j++) {
      const op_orig = change_ops[j]!
      if (op_orig.type === "set") {
        const op = pool_get_op("set")
        op.entity = entity
        op.component_id = op_orig.component_id
        op.version = op_orig.version
        op.rel = op_orig.rel
        op.data = get_component_value(world, entity, {
          id: op_orig.component_id,
          __component_brand: true,
        } as ComponentLike)
        reduced_ops.push(op)
      }
    }
    const removals = Array.from(component_removals)
    for (let j = 0; j < removals.length; j++) {
      const id = removals[j]!
      const op = pool_get_op("remove")
      op.entity = entity
      op.component_id = id
      reduced_ops.push(op)
    }
  }

  reduced_ops.sort((a, b) => {
    if (a.type === "despawn" && b.type !== "despawn") return -1
    if (a.type !== "despawn" && b.type === "despawn") return 1
    return 0
  })

  if (reduced_ops.length > 0) {
    world.recorder({
      hi,
      seq: next_op_seq(world.registry, hi),
      tick: world.tick,
      ops: reduced_ops,
    })
  }

  for (let i = 0; i < world.pending_ops.length; i++) {
    pool_return_op(world.pending_ops[i]!)
  }
  world.pending_ops.length = 0
}

export function advance_tick(world: World<any>, skip_snapshot = false): void {
  world.tick++
  if (!skip_snapshot && world.history) {
    push_snapshot(world, world.history)
  }
  world.tick_spawn_count = 0
}

export function world_flush_graph_changes(world: World<any>) {
  const batches = world._batch_map as Map<number, EntityGraphBatch>
  batches.clear()

  sparse_map_for_each(world.graph_changes, (entity, move) => {
    if (move.from === move.to) return

    const key = create_entity_batch_key(move.from?.id ?? -1, move.to?.id ?? -1)
    let batch = batches.get(key)
    if (!batch) {
      batch = pool_get_batch(move.from, move.to)
      batches.set(key, batch)
    }
    entity_graph_batch_add(batch, entity as Entity)
  })

  batches.forEach((batch) => {
    if (!batch.prev_node) {
      emit_spawned_entities(batch)
    } else if (!batch.next_node) {
      emit_despawned_entities(batch)
    } else {
      emit_moved_entities(batch, world.component_registry)
    }
    pool_return_batch(batch)
  })

  sparse_map_clear(world.graph_changes)

  world.pending_node_pruning.forEach((node) => {
    if (
      node.strategy === PruneStrategy.WhenEmpty &&
      sparse_set_size(node.entities) === 0
    ) {
      entity_graph_node_prune(world.entity_graph, node)
    }
  })
  world.pending_node_pruning.clear()
}

export function world_flush_deletions(world: World<any>) {
  world.pending_deletions.forEach((entity) => {
    world.relations.object_to_subjects.delete(entity)

    const entity_index = sparse_map_get(world.index.entity_to_index, entity)
    if (entity_index !== undefined) {
      world.index.free_indices.push(entity_index)
      sparse_map_delete(world.index.entity_to_index, entity)
    }

    remove_entity(world.registry, entity)
  })

  world.pending_component_removals.forEach((components, entity) => {
    for (let j = 0; j < components.length; j++) {
      delete_component_value(world, entity, components[j]!)
    }
  })

  world.pending_deletions.clear()
  world.pending_component_removals.clear()
}
