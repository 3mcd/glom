import type {Component, ComponentInstance, ComponentLike} from "./component"
import {type Entity, get_domain_id} from "./entity"
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
  entity_graph_node_add_relation,
  entity_graph_node_prune,
  entity_graph_node_remove_entity,
  entity_graph_node_remove_relation,
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
import {add_domain_entity} from "./entity_registry_domain"
import {HistoryBuffer, push_snapshot} from "./history"
import type {ReplicationOp, SetOp} from "./net_types"
import {is_relationship} from "./relation"
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
  TRANSIENT_DOMAIN,
} from "./replication"
import {Replicated, ReplicationStream} from "./replication_config"
import {
  sparse_map_clear,
  sparse_map_delete,
  sparse_map_for_each,
  sparse_map_get,
  sparse_map_set,
} from "./sparse_map"
import {sparse_set_size} from "./sparse_set"
import {make_vec, vec_difference, vec_sum} from "./vec"
import {
  add_resource,
  delete_component_value,
  get_component_value,
  get_resource,
  set_component_value,
  type World,
  world_get_or_create_index,
} from "./world"

export {
  add_resource,
  delete_component_value,
  get_component_value,
  get_resource,
  set_component_value,
  type World,
  world_get_or_create_index,
}

function record_graph_move(
  world: World,
  entity: Entity,
  prev_node: EntityGraphNode | undefined,
  next_node: EntityGraphNode | undefined,
) {
  if (prev_node) {
    world.pending_node_pruning.add(prev_node)
  }
  let move = sparse_map_get(world.graph_changes, entity as number)
  if (!move) {
    move = {entity, from: prev_node, to: next_node}
    sparse_map_set(world.graph_changes, entity as number, move)
  } else {
    move.to = next_node
  }
}

export function world_set_entity_node(
  world: World,
  entity: Entity,
  next_node: EntityGraphNode,
): EntityGraphNode | undefined {
  const index = world_get_or_create_index(world, entity as number)
  const prev_node = entity_graph_set_entity_node(
    world.entity_graph,
    entity,
    next_node,
    index,
  )
  if (prev_node === next_node) return prev_node

  const incoming = world.relations.object_to_subjects.get(entity)
  if (incoming) {
    for (const {subject, relation_id} of incoming) {
      if (prev_node) {
        entity_graph_node_remove_relation(
          prev_node,
          relation_id,
          subject as Entity,
          entity,
        )
      }
      entity_graph_node_add_relation(
        next_node,
        relation_id,
        subject as Entity,
        entity,
      )
    }
  }

  return prev_node
}

export function spawn(
  world: World,
  components: (ComponentInstance<unknown> | ComponentLike)[],
  domain_id = world.registry.domain_id,
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
    add_domain_entity(get_domain(world.registry, get_domain_id(entity)), entity)
  } else {
    const is_prediction = !!get_resource(world, HistoryBuffer)
    const actual_domain_id = is_prediction ? TRANSIENT_DOMAIN : domain_id
    entity = alloc_entity(world.registry, actual_domain_id)
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

  if (get_domain_id(entity) === TRANSIENT_DOMAIN) {
    world.transient_registry.set(causal_key, {
      entity,
      tick: world.tick,
    })
  }

  if (domain_id === world.registry.domain_id) {
    let replicated_check = false
    for (let i = 0; i < resolved_components.length; i++) {
      if (
        world.component_registry.get_id(
          resolved_components[i] as ComponentLike,
        ) === Replicated.id
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
        const c = resolved_components[i] as ComponentLike
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
  const prev_node = world_set_entity_node(world, entity, node)

  record_graph_move(world, entity, prev_node, node)

  return entity
}

export function despawn(world: World, entity: Entity): void {
  const node = entity_graph_get_entity_node(world.entity_graph, entity)
  if (!node) {
    return
  }

  const domain_id = world.registry.domain_id
  if (get_domain_id(entity) === domain_id) {
    let is_replicated = false
    const elements = node.vec.elements
    for (let i = 0; i < elements.length; i++) {
      if (
        world.component_registry.get_id(elements[i] as ComponentLike) ===
        Replicated.id
      ) {
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
      const {subject, relation_id} = to_remove[i] as {
        subject: Entity
        relation_id: number
      }
      remove_relation(world, subject as Entity, relation_id, entity)
    }
  }

  const elements = node.vec.elements
  for (let i = 0; i < elements.length; i++) {
    const comp = elements[i] as ComponentLike
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
    const incoming = world.relations.object_to_subjects.get(entity)
    if (incoming) {
      for (const {subject, relation_id} of incoming) {
        entity_graph_node_remove_relation(
          prev_node,
          relation_id,
          subject as Entity,
          entity,
        )
      }
    }
    entity_graph_node_remove_entity(prev_node, entity)
    sparse_map_delete(world.entity_graph.by_entity, entity as number)
    record_graph_move(world, entity, prev_node, undefined)
  }
}

function remove_relation(
  world: World,
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
    const comp = elements[i] as ComponentLike
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
  const prev_node = world_set_entity_node(world, entity, next_node)
  record_graph_move(world, entity, prev_node, next_node)
}

export function add_component(
  world: World,
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
    if (get_domain_id(entity) === world.registry.domain_id) {
      let already_replicated = false
      const elements = node.vec.elements
      for (let i = 0; i < elements.length; i++) {
        if (
          world.component_registry.get_id(elements[i] as ComponentLike) ===
          Replicated.id
        ) {
          already_replicated = true
          break
        }
      }

      let adding_replicated = false
      for (let i = 0; i < to_add.length; i++) {
        if (
          world.component_registry.get_id(to_add[i] as ComponentLike) ===
          Replicated.id
        ) {
          adding_replicated = true
          break
        }
      }

      if (already_replicated) {
        for (let i = 0; i < to_add.length; i++) {
          const c = to_add[i] as ComponentLike
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
          const c = all_components[i] as ComponentLike
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
    const prev_node = world_set_entity_node(world, entity, next_node)
    record_graph_move(world, entity, prev_node, next_node)
  }
}

export function remove_component(
  world: World,
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
        const comp = elements[i] as ComponentLike
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
    if (get_domain_id(entity) === world.registry.domain_id) {
      let is_replicated = false
      const elements = node.vec.elements
      for (let i = 0; i < elements.length; i++) {
        if (
          world.component_registry.get_id(elements[i] as ComponentLike) ===
          Replicated.id
        ) {
          is_replicated = true
          break
        }
      }
      if (is_replicated) {
        for (let i = 0; i < to_remove.length; i++) {
          const c = to_remove[i] as ComponentLike
          const op = pool_get_op("remove")
          op.entity = entity
          op.component_id = world.component_registry.get_id(c)
          world.pending_ops.push(op)
        }
      }
    }

    for (let i = 0; i < to_remove.length; i++) {
      const c = to_remove[i] as ComponentLike
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
    const prev_node = world_set_entity_node(world, entity, next_node)
    record_graph_move(world, entity, prev_node, next_node)
  }
}

export function commit_transaction(world: World): void {
  const stream = get_resource(world, ReplicationStream)
  if (!stream || world.pending_ops.length === 0) {
    for (let i = 0; i < world.pending_ops.length; i++) {
      pool_return_op(world.pending_ops[i] as ReplicationOp)
    }
    world.pending_ops.length = 0
    return
  }

  const domain_id = world.registry.domain_id
  const reduced_ops: ReplicationOp[] = []
  const entity_to_ops = world._reduction_entity_to_ops
  entity_to_ops.clear()

  for (let i = 0; i < world.pending_ops.length; i++) {
    const op = world.pending_ops[i] as ReplicationOp
    let list = entity_to_ops.get(op.entity)
    if (!list) {
      list = []
      entity_to_ops.set(op.entity, list)
    }
    list.push(op)
  }

  const entities = Array.from(entity_to_ops.keys())
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i] as Entity
    const ops = entity_to_ops.get(entity) as ReplicationOp[]

    let was_spawned = false
    for (let j = 0; j < ops.length; j++) {
      if ((ops[j] as ReplicationOp).type === "spawn") {
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

      let spawn_op_orig: Extract<ReplicationOp, {type: "spawn"}> | undefined
      for (let j = 0; j < ops.length; j++) {
        const op = ops[j] as ReplicationOp
        if (op.type === "spawn") {
          spawn_op_orig = op as Extract<ReplicationOp, {type: "spawn"}>
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
        const c = elements[j] as ComponentLike
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
      const op = ops[j] as ReplicationOp
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
      const op_orig = change_ops[j] as SetOp
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
      const id = removals[j] as number
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
    stream.transactions.push({
      domain_id,
      seq: next_op_seq(world.registry, domain_id),
      tick: world.tick,
      ops: reduced_ops,
    })
  }

  for (let i = 0; i < world.pending_ops.length; i++) {
    pool_return_op(world.pending_ops[i] as ReplicationOp)
  }
  world.pending_ops.length = 0
}

export function advance_tick(world: World, skip_snapshot = false): void {
  world.tick++
  const history = get_resource(world, HistoryBuffer)
  if (!skip_snapshot && history) {
    push_snapshot(world, history)
  }
  world.tick_spawn_count = 0
}

export function world_flush_graph_changes(world: World) {
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

export function world_flush_deletions(world: World) {
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
      delete_component_value(world, entity, components[j] as ComponentLike)
    }
  })

  world.pending_deletions.clear()
  world.pending_component_removals.clear()
}
