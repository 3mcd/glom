import { COMMAND_DOMAIN, CommandEntity, CommandOf, IntentTick } from "./command"
import { type ComponentLike, define_component } from "./component"
import { ENTITY, type Entity } from "./entity"
import { All } from "./query/all"
import { Has, Read, World as WorldTerm } from "./query/term"
import {
  cleanup_transient_entities,
  perform_batch_reconciliation,
  prune_buffers,
} from "./reconciliation"
import { apply_transaction } from "./replication"
import {
  apply_snapshot_stream,
  capture_snapshot_stream,
} from "./snapshot_stream"
import { define_system } from "./system"
import type { SystemSchedule } from "./system_schedule"
import { GlomMonitors } from "./systems/monitors"
import type { World } from "./world"
import {
  add_component,
  advance_tick,
  commit_transaction,
  despawn,
  remove_component,
  spawn,
} from "./world_api"

export const ReplicationConfig = define_component<{
  history_window?: number
  ghost_cleanup_window?: number
  snapshot_components?: number[]
  simulation_schedule?: SystemSchedule
}>(1004)

export const GlomNetwork = {
  reconcile: {
    /**
     * System Group: Reconciliation
     * Processes remote transactions for the current tick.
     */
    apply_remote_transactions: define_system(
      (world: World) => {
        const transactions = world.remote_transactions.get(world.tick)
        if (transactions) {
          for (const tx of transactions) {
            apply_transaction(world, tx)
          }
          world.remote_transactions.delete(world.tick)
        }
      },
      { params: [WorldTerm()], name: "apply_remote_transactions" },
    ),

    /**
     * System Group: Reconciliation
     * Processes remote snapshots for the current tick.
     */
    apply_remote_snapshots: define_system(
      (world: World) => {
        const snapshots = world.remote_snapshots.get(world.tick)
        if (snapshots) {
          for (const snap of snapshots) {
            apply_snapshot_stream(world, snap)
          }
          world.remote_snapshots.delete(world.tick)
        }
      },
      { params: [WorldTerm()], name: "apply_remote_snapshots" },
    ),

    /**
     * System Group: Reconciliation
     * Performs a batch reconciliation by rolling back to the oldest un-applied
     * transaction and re-simulating using the provided schedule.
     */
    perform_rollback: define_system(
      (config: Read<typeof ReplicationConfig>, world: World) => {
        if (!config.simulation_schedule) return
        perform_batch_reconciliation(world, config.simulation_schedule)
      },
      {
        params: [Read(ReplicationConfig), WorldTerm()],
        name: "perform_rollback",
      },
    ),

    /**
     * System Group: Reconciliation
     * Removes predicted entities that were never confirmed by the server
     * within the provided window (default 60 ticks).
     */
    cleanup_ghosts: define_system(
      (config: Read<typeof ReplicationConfig>, world: World) => {
        const window = config.ghost_cleanup_window ?? 60
        cleanup_transient_entities(world, world.tick - window)
      },
      {
        params: [Read(ReplicationConfig), WorldTerm()],
        name: "cleanup_ghosts",
      },
    ),
  },

  commands: {
    /**
     * System Group: Command Lifecycle (Setup)
     * Spawns ephemeral command entities for the current tick and links them to targets.
     */
    spawn_ephemeral_commands: define_system(
      (world: World) => {
        const commands = world.command_buffer.get(world.tick)
        if (!commands) return

        for (const cmd of commands) {
          const comp: ComponentLike = {
            id: cmd.component_id,
            __component_brand: true,
          }
          let command_entity: Entity
          const base_components = [IntentTick(cmd.intent_tick), CommandEntity]
          if (cmd.data !== undefined) {
            command_entity = spawn(
              world,
              [{ component: comp, value: cmd.data }, ...base_components],
              COMMAND_DOMAIN,
            )
          } else {
            const tag_comp: ComponentLike = { ...comp, is_tag: true }
            command_entity = spawn(
              world,
              [tag_comp, ...base_components],
              COMMAND_DOMAIN,
            )
          }

          // Link to target
          add_component(world, cmd.target, CommandOf(command_entity))
        }
      },
      { params: [WorldTerm()], name: "spawn_ephemeral_commands" },
    ),

    /**
     * System Group: Command Lifecycle (Teardown)
     * Despawns all entities tagged with CommandEntity and removes CommandOf relations.
     */
    cleanup_ephemeral_commands: define_system(
      (query: All<typeof ENTITY, Has<typeof CommandEntity>>, world: World) => {
        for (const [cmd_ent] of query) {
          // Find who this command belongs to (incoming relations)
          const incoming = world.relations.object_to_subjects.get(cmd_ent)
          if (incoming) {
            for (const { subject, relation_id } of Array.from(incoming)) {
              if (relation_id === CommandOf.id) {
                remove_component(world, subject as Entity, CommandOf(cmd_ent))
              }
            }
          }
          despawn(world, cmd_ent)
        }
      },
      {
        params: [All(ENTITY, Has(CommandEntity)), WorldTerm()],
        name: "cleanup_ephemeral_commands",
      },
    ),
  },

  replicate: {
    /**
     * System Group: Replication
     * Packages all mutations recorded during the tick into a transaction.
     */
    commit_pending_mutations: define_system(
      (world: World) => {
        commit_transaction(world)
      },
      { params: [WorldTerm()], name: "commit_pending_mutations" },
    ),

    /**
     * System Group: Replication
     * Captures and emits snapshots for the provided component IDs.
     */
    emit_snapshots: define_system(
      (config: Read<typeof ReplicationConfig>, world: World) => {
        if (!world.snapshot_emitter || !config.snapshot_components) return
        const blocks = capture_snapshot_stream(
          world,
          config.snapshot_components,
        )
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
    ),

    /**
     * System Group: Replication
     * Prunes old history and command buffers.
     * Keeps the last N ticks (default 64).
     */
    prune_temporal_buffers: define_system(
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
    ),

    /**
     * System Group: Lifecycle
     * Increments the world tick and captures a snapshot.
     */
    advance_world_tick: define_system(
      (world: World) => {
        advance_tick(world)
      },
      { params: [WorldTerm()], name: "advance_world_tick" },
    ),
  },
}
