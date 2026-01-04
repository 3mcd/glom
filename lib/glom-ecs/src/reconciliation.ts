import {prune_commands} from "./command"
import {get_hi} from "./entity"
import {rollback_to_tick, type Snapshot} from "./history"
import {Read, World as WorldTerm} from "./query/term"
import {
  apply_transaction,
  TRANSIENT_DOMAIN,
  type Transaction,
} from "./replication"
import {ReplicationConfig} from "./replication_config"
import {apply_snapshot_stream} from "./snapshot_stream"
import {define_system} from "./system"
import {run_schedule, type SystemSchedule} from "./system_schedule"
import type {World} from "./world"
import {
  advance_tick,
  commit_transaction,
  despawn,
  world_flush_graph_changes,
} from "./world_api"

export function receive_transaction(world: World, tx: Transaction) {
  let list = world.remote_transactions.get(tx.tick)
  if (!list) {
    list = []
    world.remote_transactions.set(tx.tick, list)
  }
  list.push(tx)
}

export function resimulate_with_transactions(
  world: World,
  to_tick: number,
  tick_fn: (world: World, input: unknown) => void,
) {
  const from_tick = world.tick
  for (let t = from_tick; t < to_tick; t++) {
    // 1. Apply any remote transactions for THIS tick
    const transactions = world.remote_transactions.get(t)
    if (transactions) {
      for (const tx of transactions) {
        apply_transaction(world, tx)
      }
      world_flush_graph_changes(world)
    }

    // 2. Advance to next state using local inputs
    const input = world.input_buffer.get(t + 1)
    tick_fn(world, input)

    // 3. Record local mutations and advance tick
    commit_transaction(world)
    advance_tick(world)
  }
}

export function reconcile_transaction(
  world: World,
  tx: Transaction,
  tick_fn: (world: World, input: unknown) => void,
) {
  receive_transaction(world, tx)

  if (tx.tick >= world.tick) {
    return
  }

  if (!world.history) return

  const original_tick = world.tick
  if (rollback_to_tick(world, world.history, tx.tick)) {
    resimulate_with_transactions(world, original_tick, tick_fn)
  } else {
    // Fallback: Apply directly to current state if rollback fails
    apply_transaction(world, tx)
    world_flush_graph_changes(world)
    world.remote_transactions.delete(tx.tick)
  }
}

export function prune_buffers(world: World, min_tick: number) {
  // Prune remote transactions
  for (const tick of world.remote_transactions.keys()) {
    if (tick < min_tick) {
      world.remote_transactions.delete(tick)
    }
  }

  // Prune remote snapshots
  for (const tick of world.remote_snapshots.keys()) {
    if (tick < min_tick) {
      world.remote_snapshots.delete(tick)
    }
  }

  // Prune input buffer
  for (const tick of world.input_buffer.keys()) {
    if (tick < min_tick) {
      world.input_buffer.delete(tick)
    }
  }

  // Prune history
  if (world.history) {
    const snapshots = world.history.snapshots
    while (snapshots.length > 0) {
      const first = snapshots[0]
      if (first && first.tick < min_tick) {
        snapshots.shift()
      } else {
        break
      }
    }
  }

  // Prune command buffer
  prune_commands(world, min_tick)
}

/**
 * Finds the oldest un-applied remote transaction in the past,
 * rolls back the world to that point, and re-simulates forward
 * using the provided schedule.
 *
 * This is intended to be called once per frame at the start of the simulation loop.
 */
export function perform_batch_reconciliation(
  world: World,
  schedule: SystemSchedule,
) {
  if (!world.history) return

  // 1. Find the oldest un-applied remote transaction that is in the past
  let min_tick = Infinity
  for (const tick of world.remote_transactions.keys()) {
    if (tick < world.tick) {
      min_tick = Math.min(min_tick, tick)
    }
  }

  if (min_tick === Infinity) return

  const original_tick = world.tick

  // 2. Rollback to the oldest transaction tick
  // The snapshot at min_tick represents the state at the START of that tick.
  if (rollback_to_tick(world, world.history, min_tick)) {
    // 3. Re-simulate forward from min_tick up to original_tick - 1
    while (world.tick < original_tick) {
      // 3a. Run simulation for the current tick
      run_schedule(schedule, world as World)
      commit_transaction(world)

      // 3b. Apply any remote transactions for THIS specific tick.
      // These are the authoritative results of the tick we just simulated.
      const transactions = world.remote_transactions.get(world.tick)
      if (transactions) {
        for (const tx of transactions) {
          apply_transaction(world, tx)
        }
        world_flush_graph_changes(world)
        world.remote_transactions.delete(world.tick)
      }

      // 3c. Advance to next tick (unless we just finished original_tick - 1)
      if (world.tick < original_tick) {
        const next_tick = world.tick + 1
        const next_txs = world.remote_transactions.get(next_tick)
        const has_next_tx = next_txs && next_txs.length > 0
        const is_checkpoint = next_tick % 5 === 0
        const is_last = next_tick === original_tick

        // We ALWAYS capture if it's the last tick (the current one) to ensure
        // the history snapshot is updated with corrected data.
        advance_tick(world, is_last || !(has_next_tx || is_checkpoint))
      }
    }
  } else {
    // Fallback: We can't rollback to this tick (e.g. join-in-progress or history overflow).
    // Apply all transactions that are too old to rollback to directly to the current state.
    const oldest_history_tick =
      world.history.snapshots.length > 0
        ? (world.history.snapshots[0] as Snapshot).tick
        : world.tick

    const sorted_ticks = Array.from(world.remote_transactions.keys()).sort(
      (a, b) => a - b,
    )
    for (const tick of sorted_ticks) {
      if (tick < oldest_history_tick) {
        const txs = world.remote_transactions.get(tick)
        if (txs) {
          for (const tx of txs) {
            apply_transaction(world, tx)
          }
          world_flush_graph_changes(world)
          world.remote_transactions.delete(tick)
        }
      } else {
        break
      }
    }
  }
}

export function cleanup_transient_entities(
  world: World,
  authoritative_tick: number,
) {
  for (const [key, info] of world.transient_registry.entries()) {
    if (info.tick < authoritative_tick) {
      // If it's still in the TRANSIENT_DOMAIN, it was never confirmed by the server.
      // Despawn it.
      if (get_hi(info.entity) === TRANSIENT_DOMAIN) {
        despawn(world, info.entity)
      }
      // Regardless, remove from registry as the "window" for rebinding has closed.
      world.transient_registry.delete(key)
    }
  }
}

/**
 * System: Processes remote transactions for the current tick.
 */
export const apply_remote_transactions = define_system(
  (world: World) => {
    const transactions = world.remote_transactions.get(world.tick)
    if (transactions) {
      for (const tx of transactions) {
        apply_transaction(world, tx)
      }
      world.remote_transactions.delete(world.tick)
    }
  },
  {params: [WorldTerm()], name: "apply_remote_transactions"},
)

/**
 * System: Processes remote snapshots for the current tick.
 */
export const apply_remote_snapshots = define_system(
  (world: World) => {
    const snapshots = world.remote_snapshots.get(world.tick)
    if (snapshots) {
      for (const snap of snapshots) {
        apply_snapshot_stream(world, snap)
      }
      world.remote_snapshots.delete(world.tick)
    }
  },
  {params: [WorldTerm()], name: "apply_remote_snapshots"},
)

/**
 * System: Performs a batch reconciliation by rolling back to the oldest un-applied
 * transaction and re-simulating using the provided schedule.
 */
export const perform_rollback = define_system(
  (config: Read<typeof ReplicationConfig>, world: World) => {
    if (!config.simulation_schedule) return
    perform_batch_reconciliation(world, config.simulation_schedule)
  },
  {
    params: [Read(ReplicationConfig), WorldTerm()],
    name: "perform_rollback",
  },
)

/**
 * System: Removes predicted entities that were never confirmed by the server
 * within the provided window (default 60 ticks).
 */
export const cleanup_ghosts = define_system(
  (config: Read<typeof ReplicationConfig>, world: World) => {
    const window = config.ghost_cleanup_window ?? 60
    cleanup_transient_entities(world, world.tick - window)
  },
  {
    params: [Read(ReplicationConfig), WorldTerm()],
    name: "cleanup_ghosts",
  },
)
