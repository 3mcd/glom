import { define_tag, type Component, type ComponentLike } from "./component"
import type { Entity } from "./entity"
import {
  entity_graph_find_or_create_node,
  entity_graph_get_entity_node,
  entity_graph_node_add_entity,
  entity_graph_node_remove_entity,
  entity_graph_set_entity_node,
} from "./entity_graph"
import {
  get_domain,
  next_op_seq,
  remove_entity,
} from "./entity_registry"
import {
  add_domain_entity,
  make_entity_registry_domain,
  remove_domain_entity,
} from "./entity_registry_domain"
import { hash_word } from "./lib/hash"
import { is_relationship } from "./relation"
import {
  get_or_create_virtual_id,
  get_virtual_id,
  register_incoming_relation,
  unregister_incoming_relation,
} from "./relation_registry"
import { sparse_map_delete, sparse_map_get, sparse_map_set } from "./sparse_map"
import { make_vec, vec_difference, vec_sum } from "./vec"
import {
  delete_component_value,
  get_component_store,
  get_component_value,
  set_component_value,
  type World,
} from "./world"
import { add_component, remove_component } from "./world_api"

export const Replicated = define_tag(1000)

export const TRANSIENT_DOMAIN = 2046 // Reserved domain for predicted spawns

export type ReplicationOp =
  | {
      type: "spawn"
      entity: Entity
      components: {
        id: number
        data?: unknown
        rel?: { relation_id: number; object: number }
      }[]
      causal_key?: number
    }
  | { type: "despawn"; entity: Entity }
  | {
      type: "set"
      entity: Entity
      component_id: number
      data: unknown
      version?: number
      rel?: { relation_id: number; object: number }
    }
  | { type: "remove"; entity: Entity; component_id: number }

export type Transaction = {
  hi: number // Domain/Agent ID
  seq: number // Domain-local sequence number
  tick: number // Global simulation tick
  ops: ReplicationOp[]
}

export type ReplicationRecorder = (batch: Transaction) => void

const OP_POOL: ReplicationOp[] = []

export function pool_get_op<T extends ReplicationOp["type"]>(
  type: T,
): Extract<ReplicationOp, { type: T }> {
  const op = OP_POOL.pop()
  if (op) {
    const mutable_op = op as { type: string }
    mutable_op.type = type
    return op as Extract<ReplicationOp, { type: T }>
  }
  return { type } as unknown as Extract<ReplicationOp, { type: T }>
}

export function pool_return_op(op: ReplicationOp) {
  if (op.type === "spawn") {
    op.components.length = 0
  }
  OP_POOL.push(op)
}

/**
 * Generates a deterministic key for an entity spawn event.
 * This key is used to correlate a predicted local spawn with its
 * eventual authoritative confirmation from the server.
 */
export function make_causal_key(tick: number, spawn_index: number): number {
  return hash_word(tick, spawn_index) >>> 0
}

/**
 * Transitions an entity from a transient (predicted) ID to an
 * authoritative ID while preserving its component data and 
 * position in the entity graph.
 */
export function rebind_entity(
  world: World,
  transient: Entity,
  authoritative: Entity,
) {
  console.log(`[REBIND] ${transient} -> ${authoritative}`);
  if (transient === authoritative) return

  const index = sparse_map_get(world.index.entity_to_index, transient)
  if (index === undefined) {
    console.log(`[REBIND FAILED] ${transient} not in index`);
    return
  }

  // 1. Remove transient from its domain (but keep its data/index)
  remove_entity(world.registry, transient)

  // 2. Update index
  sparse_map_set(world.index.entity_to_index, authoritative, index)
  world.index.index_to_entity[index] = authoritative
  sparse_map_delete(world.index.entity_to_index, transient)

  // Update graph
  const node = sparse_map_get(world.entity_graph.by_entity, transient as number)
  if (node) {
    entity_graph_node_remove_entity(node, transient)
    entity_graph_node_add_entity(node, authoritative)
    sparse_map_set(world.entity_graph.by_entity, authoritative as number, node)
    sparse_map_delete(world.entity_graph.by_entity, transient as number)
  }

  // 3. Update incoming relations (entities pointing TO this entity)
  const incoming = world.relations.object_to_subjects.get(transient)
  if (incoming) {
    const relations_to_move = Array.from(incoming)
    for (let i = 0; i < relations_to_move.length; i++) {
      const { subject, relation_id } = relations_to_move[i]!
      const relation = ((object: Entity) => ({
        relation: { id: relation_id, __relation_brand: true } as unknown as ComponentLike,
        object,
      })) as unknown as (object: Entity) => ComponentLike
      // 1. Remove the relationship pointing to the old (transient) ID
      remove_component(world, subject as Entity, relation(transient))
      // 2. Add the relationship pointing to the new (authoritative) ID
      add_component(world, subject as Entity, relation(authoritative))
    }
    world.relations.object_to_subjects.delete(transient)
  }

  // 4. Update command buffer (patch existing commands to point to the new ID)
  const cmd_buffers = Array.from(world.command_buffer.values())
  for (let i = 0; i < cmd_buffers.length; i++) {
    const commands = cmd_buffers[i]!
    for (let j = 0; j < commands.length; j++) {
      const cmd = commands[j]!
      if (cmd.target === transient) {
        cmd.target = authoritative
      }
    }
  }
}

export function apply_transaction(world: World, batch: Transaction) {
  const domain = get_domain(world.registry, batch.hi)

  // Causal check: if seq is not what we expect, we might need to buffer or request missing
  if (batch.seq !== domain.op_seq) {
    // For now, we just warn and proceed, but a robust system would buffer or re-request
    console.warn(
      `Out of order batch for domain ${batch.hi}: expected ${domain.op_seq}, got ${batch.seq}`,
    )
  }

  const ops = batch.ops
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!
    switch (op.type) {
      case "spawn": {
        let entity = op.entity

        // Handle rebind if causal key matches a transient entity
        if (op.causal_key !== undefined) {
          const transient_info = world.transient_registry.get(op.causal_key)
          if (transient_info !== undefined) {
            rebind_entity(world, transient_info.entity, entity)
            // Keep the mapping but update to authoritative ID so re-simulation finds it
            world.transient_registry.set(op.causal_key, {
              ...transient_info,
              entity,
            })
          }
        }

        add_domain_entity(domain, entity)
        const resolved: ComponentLike[] = []
        const components = op.components
        for (let j = 0; j < components.length; j++) {
          const { id, data, rel } = components[j]!
          const comp = { id, __component_brand: true } as unknown as ComponentLike
          if (data !== undefined) {
            set_component_value(world, entity, comp, data, batch.tick)
          } else {
            const mutable_comp = comp as { is_tag?: boolean }
            mutable_comp.is_tag = true
          }
          resolved.push(comp)

          // Handle relations if it's a virtual ID
          if (rel) {
            // Ensure virtual ID mapping is established in target world
            let rel_map = world.relations.rel_to_virtual.get(rel.relation_id)
            if (!rel_map) {
              rel_map = new Map()
              world.relations.rel_to_virtual.set(rel.relation_id, rel_map)
            }
            rel_map.set(rel.object, id)
            world.relations.virtual_to_rel.set(id, rel)

            register_incoming_relation(
              world,
              entity,
              rel.relation_id,
              rel.object as Entity,
            )
          }
        }
        const node = entity_graph_find_or_create_node(
          world.entity_graph,
          make_vec(resolved),
        )
        // if (batch.hi === 0) console.log(`Entity ${entity} spawned in node ${node.id} (${node.vec.ids})`);
        entity_graph_set_entity_node(world.entity_graph, entity, node)
        break
      }
      case "despawn": {
        const node = entity_graph_get_entity_node(world.entity_graph, op.entity)
        if (!node) break

        // Clean up relations where this entity is the object
        const incoming = world.relations.object_to_subjects.get(op.entity)
        if (incoming) {
          incoming.forEach(({ subject, relation_id }) => {
            // This is complex because we need to move the subject to a new node
            // For now, let's keep it simple and just delete the storage
          })
          world.relations.object_to_subjects.delete(op.entity)
        }

        // Clean up outgoing relations
        const elements = node.vec.elements
        for (let j = 0; j < elements.length; j++) {
          const comp = elements[j]!
          const rel = world.relations.virtual_to_rel.get(comp.id)
          if (rel) {
            unregister_incoming_relation(
              world,
              op.entity,
              rel.relation_id,
              rel.object as Entity,
            )
          }
          delete_component_value(world, op.entity, comp)
        }

        entity_graph_set_entity_node(
          world.entity_graph,
          op.entity,
          world.entity_graph.root,
        )
        remove_domain_entity(domain, op.entity)
        break
      }
      case "set": {
        const entity = op.entity
        const comp = { id: op.component_id, __component_brand: true } as unknown as ComponentLike
        const node = entity_graph_get_entity_node(world.entity_graph, entity)
        if (!node) break

        set_component_value(
          world,
          entity,
          comp,
          op.data,
          op.version ?? batch.tick,
        )

        // Handle relations if it's a virtual ID
        if (op.rel) {
          const rel = op.rel
          const id = op.component_id
          // Ensure virtual ID mapping is established in target world
          let rel_map = world.relations.rel_to_virtual.get(rel.relation_id)
          if (!rel_map) {
            rel_map = new Map()
            world.relations.rel_to_virtual.set(rel.relation_id, rel_map)
          }
          rel_map.set(rel.object, id)
          world.relations.virtual_to_rel.set(id, rel)

          register_incoming_relation(
            world,
            entity,
            rel.relation_id,
            rel.object as Entity,
          )
        }

        // If it's a new component for this entity, update the graph
        let has_comp = false
        const elements = node.vec.elements
        for (let j = 0; j < elements.length; j++) {
          if (elements[j]!.id === op.component_id) {
            has_comp = true
            break
          }
        }

        if (!has_comp) {
          const next_node = entity_graph_find_or_create_node(
            world.entity_graph,
            vec_sum(node.vec, make_vec([comp])),
          )
          entity_graph_set_entity_node(world.entity_graph, entity, next_node)
        }
        break
      }
      case "remove": {
        const entity = op.entity
        const id = op.component_id
        const comp = { id, __component_brand: true } as unknown as ComponentLike
        const node = entity_graph_get_entity_node(world.entity_graph, entity)
        if (!node) break

        const rel_info = world.relations.virtual_to_rel.get(id)
        if (rel_info) {
          unregister_incoming_relation(
            world,
            entity,
            rel_info.relation_id,
            rel_info.object as Entity,
          )
        }

        delete_component_value(world, entity, comp)

        const next_node = entity_graph_find_or_create_node(
          world.entity_graph,
          vec_difference(node.vec, make_vec([comp])),
        )
        entity_graph_set_entity_node(world.entity_graph, entity, next_node)
        break
      }
    }
  }

  domain.op_seq = batch.seq + 1
}
