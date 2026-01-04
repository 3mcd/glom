import type {Component, ComponentLike} from "./component"
import {Replicated, ReplicationConfig} from "./replication_config"
export {Replicated, ReplicationConfig}

import type {Entity} from "./entity"
import {
  entity_graph_find_or_create_node,
  entity_graph_get_entity_node,
  entity_graph_node_add_entity,
  entity_graph_node_remove_entity,
  entity_graph_set_entity_node,
} from "./entity_graph"
import {get_domain, remove_entity} from "./entity_registry"
import {add_domain_entity, remove_domain_entity} from "./entity_registry_domain"
import {hash_word} from "./lib/hash"
import {Read, World as WorldTerm} from "./query/term"
import {prune_buffers} from "./reconciliation"
import type {Relation} from "./relation"
import {
  type RelationPair,
  type RelationSubject,
  register_incoming_relation,
  unregister_incoming_relation,
} from "./relation_registry"
import {capture_snapshot_stream} from "./snapshot_stream"
import {sparse_map_delete, sparse_map_get, sparse_map_set} from "./sparse_map"
import {define_system} from "./system"
import {make_vec, vec_difference, vec_sum} from "./vec"
import {
  type Command,
  delete_component_value,
  set_component_value,
  type World,
} from "./world"
import {
  add_component,
  advance_tick,
  commit_transaction,
  remove_component,
} from "./world_api"

export const TRANSIENT_DOMAIN = 2046 // Reserved domain for predicted spawns

export type SpawnComponent = {
  id: number
  data?: unknown
  rel?: RelationPair
}

export type SpawnOp = {
  type: "spawn"
  entity: Entity
  components: SpawnComponent[]
  causal_key?: number
}

export type DespawnOp = {type: "despawn"; entity: Entity}

export type SetOp = {
  type: "set"
  entity: Entity
  component_id: number
  data: unknown
  version?: number
  rel?: RelationPair
}

export type RemoveOp = {type: "remove"; entity: Entity; component_id: number}

export type ReplicationOp = SpawnOp | DespawnOp | SetOp | RemoveOp

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
): Extract<ReplicationOp, {type: T}> {
  const op = OP_POOL.pop()
  if (op) {
    const mutable_op = op as {type: string}
    mutable_op.type = type
    return op as Extract<ReplicationOp, {type: T}>
  }
  return {type} as unknown as Extract<ReplicationOp, {type: T}>
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
  if (transient === authoritative) return

  const index = sparse_map_get(world.index.entity_to_index, transient)
  if (index === undefined) {
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
      const {subject, relation_id} = relations_to_move[i] as RelationSubject
      const relation = ((object: Entity) => ({
        relation: world.component_registry.get_component(
          relation_id,
        ) as Relation,
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
    const commands = cmd_buffers[i] as Command[]
    for (let j = 0; j < commands.length; j++) {
      const cmd = commands[j] as Command
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
    const op = ops[i] as ReplicationOp
    switch (op.type) {
      case "spawn": {
        const entity = op.entity

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
          const {id, data, rel} = components[j] as SpawnComponent
          const comp = world.component_registry.get_component(id)
          if (!comp) continue

          if (data !== undefined) {
            set_component_value(
              world,
              entity,
              comp as Component<unknown>,
              data,
              batch.tick,
            )
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
          make_vec(resolved, world.component_registry),
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
          // incoming.forEach(({subject, relation_id}) => {
          // This is complex because we need to move the subject to a new node
          // For now, let's keep it simple and just delete the storage
          // })
          world.relations.object_to_subjects.delete(op.entity)
        }

        // Clean up outgoing relations
        const elements = node.vec.elements
        for (let j = 0; j < elements.length; j++) {
          const comp = elements[j] as ComponentLike
          const comp_id = world.component_registry.get_id(comp)
          const rel = world.relations.virtual_to_rel.get(comp_id)
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

        const prev_node = entity_graph_set_entity_node(
          world.entity_graph,
          op.entity,
          world.entity_graph.root,
        )
        if (prev_node) {
          world.pending_node_pruning.add(prev_node)
        }
        remove_domain_entity(domain, op.entity)
        break
      }
      case "set": {
        const entity = op.entity
        const comp = world.component_registry.get_component(op.component_id)
        if (!comp) break
        const node = entity_graph_get_entity_node(world.entity_graph, entity)
        if (!node) break

        set_component_value(
          world,
          entity,
          comp as Component<unknown>,
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
          if (
            world.component_registry.get_id(elements[j] as ComponentLike) ===
            op.component_id
          ) {
            has_comp = true
            break
          }
        }

        if (!has_comp) {
          const next_node = entity_graph_find_or_create_node(
            world.entity_graph,
            vec_sum(
              node.vec,
              make_vec([comp], world.component_registry),
              world.component_registry,
            ),
          )
          const prev_node = entity_graph_set_entity_node(
            world.entity_graph,
            entity,
            next_node,
          )
          if (prev_node) {
            world.pending_node_pruning.add(prev_node)
          }
        }
        break
      }
      case "remove": {
        const entity = op.entity
        const id = op.component_id
        const comp = world.component_registry.get_component(id)
        if (!comp) break
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
          vec_difference(
            node.vec,
            make_vec([comp], world.component_registry),
            world.component_registry,
          ),
        )
        const prev_node = entity_graph_set_entity_node(
          world.entity_graph,
          entity,
          next_node,
        )
        if (prev_node) {
          world.pending_node_pruning.add(prev_node)
        }
        break
      }
    }
  }

  domain.op_seq = batch.seq + 1
}

/**
 * System: Packages all mutations recorded during the tick into a transaction.
 */
export const commit_pending_mutations = define_system(
  (world: World) => {
    commit_transaction(world)
  },
  {params: [WorldTerm()], name: "commit_pending_mutations"},
)

/**
 * System: Captures and emits snapshots for the provided component IDs.
 */
export const emit_snapshots = define_system(
  (config: Read<typeof ReplicationConfig>, world: World) => {
    if (!world.snapshot_emitter || !config.snapshot_components) return
    const blocks = capture_snapshot_stream(world, config.snapshot_components)
    if (blocks.length > 0) {
      world.snapshot_emitter({
        tick: world.tick,
        blocks,
      })
    }
  },
  {
    params: [Read(ReplicationConfig), WorldTerm()],
    name: "emit_snapshots",
  },
)

/**
 * System: Prunes old history and command buffers.
 * Keeps the last N ticks (default 64).
 */
export const prune_temporal_buffers = define_system(
  (config: Read<typeof ReplicationConfig>, world: World) => {
    const window = config.history_window ?? 64
    const min_tick = world.tick - window
    if (min_tick > 0) {
      prune_buffers(world, min_tick)
    }
  },
  {
    params: [Read(ReplicationConfig), WorldTerm()],
    name: "prune_temporal_buffers",
  },
)

/**
 * System: Increments the world tick and captures a snapshot.
 */
export const advance_world_tick = define_system(
  (world: World) => {
    advance_tick(world)
  },
  {params: [WorldTerm()], name: "advance_world_tick"},
)
