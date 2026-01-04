import {prune_commands} from "./command"
import {get_domain_id} from "./entity"
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

export function receive_transaction(world: World, transaction: Transaction) {
  let list = world.remote_transactions.get(transaction.tick)
  if (!list) {
    list = []
    world.remote_transactions.set(transaction.tick, list)
  }
  list.push(transaction)
}

export function resimulate_with_transactions(
  world: World,
  to_tick: number,
  tick_fn: (world: World, input: unknown) => void,
) {
  const from_tick = world.tick
  for (let t = from_tick; t < to_tick; t++) {
    const transactions = world.remote_transactions.get(t)
    if (transactions) {
      for (const transaction of transactions) {
        apply_transaction(world, transaction)
      }
      world_flush_graph_changes(world)
    }

    const input = world.input_buffer.get(t + 1)
    tick_fn(world, input)

    commit_transaction(world)
    advance_tick(world)
  }
}

export function reconcile_transaction(
  world: World,
  transaction: Transaction,
  tick_fn: (world: World, input: unknown) => void,
) {
  receive_transaction(world, transaction)

  if (transaction.tick >= world.tick) {
    return
  }

  if (!world.history) return

  const original_tick = world.tick
  if (rollback_to_tick(world, world.history, transaction.tick)) {
    resimulate_with_transactions(world, original_tick, tick_fn)
  } else {
    apply_transaction(world, transaction)
    world_flush_graph_changes(world)
    world.remote_transactions.delete(transaction.tick)
  }
}

export function prune_buffers(world: World, min_tick: number) {
  for (const tick of world.remote_transactions.keys()) {
    if (tick < min_tick) {
      world.remote_transactions.delete(tick)
    }
  }

  for (const tick of world.remote_snapshots.keys()) {
    if (tick < min_tick) {
      world.remote_snapshots.delete(tick)
    }
  }

  for (const tick of world.input_buffer.keys()) {
    if (tick < min_tick) {
      world.input_buffer.delete(tick)
    }
  }

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

  prune_commands(world, min_tick)
}

export function perform_batch_reconciliation(
  world: World,
  schedule: SystemSchedule,
) {
  if (!world.history) return

  let min_tick = Infinity
  for (const tick of world.remote_transactions.keys()) {
    if (tick < world.tick) {
      min_tick = Math.min(min_tick, tick)
    }
  }

  if (min_tick === Infinity) return

  const original_tick = world.tick

  if (rollback_to_tick(world, world.history, min_tick)) {
    while (world.tick < original_tick) {
      run_schedule(schedule, world as World)
      commit_transaction(world)

      const transactions = world.remote_transactions.get(world.tick)
      if (transactions) {
        for (const transaction of transactions) {
          apply_transaction(world, transaction)
        }
        world_flush_graph_changes(world)
        world.remote_transactions.delete(world.tick)
      }

      if (world.tick < original_tick) {
        const next_tick = world.tick + 1
        const next_transactions = world.remote_transactions.get(next_tick)
        const has_next_transaction =
          next_transactions && next_transactions.length > 0
        const is_checkpoint = next_tick % 5 === 0
        const is_last = next_tick === original_tick

        advance_tick(world, is_last || !(has_next_transaction || is_checkpoint))
      }
    }
  } else {
    const oldest_history_tick =
      world.history.snapshots.length > 0
        ? (world.history.snapshots[0] as Snapshot).tick
        : world.tick

    const sorted_ticks = Array.from(world.remote_transactions.keys()).sort(
      (a, b) => a - b,
    )
    for (const tick of sorted_ticks) {
      if (tick < oldest_history_tick) {
        const transactions = world.remote_transactions.get(tick)
        if (transactions) {
          for (const transaction of transactions) {
            apply_transaction(world, transaction)
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
      if (get_domain_id(info.entity) === TRANSIENT_DOMAIN) {
        despawn(world, info.entity)
      }

      world.transient_registry.delete(key)
    }
  }
}

export const apply_remote_transactions = define_system(
  (world: World) => {
    const transactions = world.remote_transactions.get(world.tick)
    if (transactions) {
      for (const transaction of transactions) {
        apply_transaction(world, transaction)
      }
      world.remote_transactions.delete(world.tick)
    }
  },
  {params: [WorldTerm()], name: "apply_remote_transactions"},
)

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
