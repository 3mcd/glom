import type {Component, ComponentLike} from "./component"
import {Replicated, ReplicationConfig, ReplicationStream} from "./replication_config"
export {Replicated, ReplicationConfig, ReplicationStream}

import {CommandBuffer, type CommandInstance} from "./command"
import type {Entity} from "./entity"
import {
  entity_graph_find_or_create_node,
  entity_graph_get_entity_node,
  entity_graph_node_add_entity,
  entity_graph_node_remove_entity,
} from "./entity_graph"
import {get_domain, remove_entity} from "./entity_registry"
import {add_domain_entity, remove_domain_entity} from "./entity_registry_domain"
import {hash_word} from "./lib/hash"
import {Read, Write, World as WorldTerm} from "./query/term"
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
  delete_component_value,
  get_resource,
  set_component_value,
  type World,
} from "./world"
import {
  add_component,
  add_resource,
  advance_tick,
  commit_transaction,
  remove_component,
  world_set_entity_node,
} from "./world_api"

export const TRANSIENT_DOMAIN = 2046

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
  domain_id: number
  seq: number
  tick: number
  ops: ReplicationOp[]
}

export type ReplicationRecorder = (transaction: Transaction) => void

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

export function make_causal_key(tick: number, spawn_index: number): number {
  return hash_word(tick, spawn_index) >>> 0
}

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

  remove_entity(world.registry, transient)

  sparse_map_set(world.index.entity_to_index, authoritative, index)
  world.index.index_to_entity[index] = authoritative
  sparse_map_delete(world.index.entity_to_index, transient)

  const node = sparse_map_get(world.entity_graph.by_entity, transient as number)
  if (node) {
    entity_graph_node_remove_entity(node, transient)
    entity_graph_node_add_entity(node, authoritative, index)
    sparse_map_set(world.entity_graph.by_entity, authoritative as number, node)
    sparse_map_delete(world.entity_graph.by_entity, transient as number)
  }

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

      remove_component(world, subject as Entity, relation(transient))

      add_component(world, subject as Entity, relation(authoritative))
    }
    world.relations.object_to_subjects.delete(transient)
  }

  const command_buffer = get_resource(world, CommandBuffer)
  if (command_buffer) {
    const cmd_buffers = Array.from(command_buffer.values())
    for (let i = 0; i < cmd_buffers.length; i++) {
      const commands = cmd_buffers[i] as CommandInstance[]
      for (let j = 0; j < commands.length; j++) {
        const cmd = commands[j] as CommandInstance
        if (cmd.target === transient) {
          cmd.target = authoritative
        }
      }
    }
  }
}

export function apply_transaction(world: World, transaction: Transaction) {
  const domain = get_domain(world.registry, transaction.domain_id)

  if (transaction.seq !== domain.op_seq) {
    console.warn(
      `Out of order batch for domain ${transaction.domain_id}: expected ${domain.op_seq}, got ${transaction.seq}`,
    )
  }

  const ops = transaction.ops
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i] as ReplicationOp
    switch (op.type) {
      case "spawn": {
        const entity = op.entity

        if (op.causal_key !== undefined) {
          const transient_info = world.transient_registry.get(op.causal_key)
          if (transient_info !== undefined) {
            rebind_entity(world, transient_info.entity, entity)

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
              transaction.tick,
            )
          }
          resolved.push(comp)

          if (rel) {
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

        world_set_entity_node(world, entity, node)
        break
      }
      case "despawn": {
        const node = entity_graph_get_entity_node(world.entity_graph, op.entity)
        if (!node) break

        const incoming = world.relations.object_to_subjects.get(op.entity)
        if (incoming) {
          world.relations.object_to_subjects.delete(op.entity)
        }

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

        const prev_node = world_set_entity_node(
          world,
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
          op.version ?? transaction.tick,
        )

        if (op.rel) {
          const rel = op.rel
          const id = op.component_id

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
          const prev_node = world_set_entity_node(world, entity, next_node)
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
        const prev_node = world_set_entity_node(world, entity, next_node)
        if (prev_node) {
          world.pending_node_pruning.add(prev_node)
        }
        break
      }
    }
  }

  domain.op_seq = transaction.seq + 1
}

export const commit_pending_mutations = define_system(
  (world: World) => {
    commit_transaction(world)
  },
  {params: [WorldTerm()], name: "commit_pending_mutations"},
)

export const emit_snapshots = define_system(
  (
    config: Read<typeof ReplicationConfig>,
    stream: Write<typeof ReplicationStream>,
    world: World,
  ) => {
    if (!config.snapshot_components) return
    const blocks = capture_snapshot_stream(world, config.snapshot_components)
    if (blocks.length > 0) {
      stream.snapshots.push({
        tick: world.tick,
        blocks,
      })
    }
  },
  {
    params: [Read(ReplicationConfig), Write(ReplicationStream), WorldTerm()],
    name: "emit_snapshots",
  },
)

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

export const advance_world_tick = define_system(
  (world: World) => {
    advance_tick(world)
  },
  {params: [WorldTerm()], name: "advance_world_tick"},
)

export const clear_replication_stream = define_system(
  (stream: Write<typeof ReplicationStream>) => {
    stream.transactions.length = 0
    stream.snapshots.length = 0
  },
  {
    params: [Write(ReplicationStream)],
    name: "clear_replication_stream",
  },
)
