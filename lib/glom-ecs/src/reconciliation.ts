import {prune_commands} from "./command"
import {get_domain_id} from "./entity"
import {HistoryBuffer, rollback_to_tick, type Snapshot} from "./history"
import type {SnapshotMessage} from "./net_types"
import {Read, World as WorldTerm} from "./query/term"
import {
  apply_transaction,
  TRANSIENT_DOMAIN,
  type Transaction,
} from "./replication"
import {
  IncomingSnapshots,
  IncomingTransactions,
  InputBuffer,
  ReplicationConfig,
} from "./replication_config"
import {apply_snapshot_stream} from "./snapshot_stream"
import {define_system} from "./system"
import {run_schedule, type SystemSchedule} from "./system_schedule"
import type {World} from "./world"
import {add_resource, get_resource} from "./world"
import {
  advance_tick,
  commit_transaction,
  despawn,
  world_flush_graph_changes,
} from "./world_api"

export function receive_transaction(world: World, transaction: Transaction) {
  const incoming = get_resource(world, IncomingTransactions)
  if (!incoming) return
  let list = incoming.get(transaction.tick)
  if (!list) {
    list = []
    incoming.set(transaction.tick, list)
  }
  list.push(transaction)
}

export function receive_snapshot(world: World, snapshot: SnapshotMessage) {
  const incoming = get_resource(world, IncomingSnapshots)
  if (!incoming) return
  let list = incoming.get(snapshot.tick)
  if (!list) {
    list = []
    incoming.set(snapshot.tick, list)
  }
  list.push(snapshot)
}

export function resimulate_with_transactions(
  world: World,
  to_tick: number,
  tick_fn: (world: World, input: unknown) => void,
) {
  const from_tick = world.tick
  const incoming_transactions = get_resource(world, IncomingTransactions)
  const inputs = get_resource(world, InputBuffer)

  for (let t = from_tick; t < to_tick; t++) {
    const transactions = incoming_transactions?.get(t)
    if (transactions) {
      for (const transaction of transactions) {
        apply_transaction(world, transaction)
      }
      world_flush_graph_changes(world)
    }

    const input = inputs?.get(t + 1)
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

  const history = get_resource(world, HistoryBuffer)
  if (!history) return

  const original_tick = world.tick
  if (rollback_to_tick(world, history, transaction.tick)) {
    resimulate_with_transactions(world, original_tick, tick_fn)
  } else {
    apply_transaction(world, transaction)
    world_flush_graph_changes(world)
    const incoming_transactions = get_resource(world, IncomingTransactions)
    incoming_transactions?.delete(transaction.tick)
  }
}

export function prune_buffers(world: World, min_tick: number) {
  const incoming_transactions = get_resource(world, IncomingTransactions)
  if (incoming_transactions) {
    for (const tick of incoming_transactions.keys()) {
      if (tick < min_tick) {
        incoming_transactions.delete(tick)
      }
    }
  }

  const incoming_snapshots = get_resource(world, IncomingSnapshots)
  if (incoming_snapshots) {
    for (const tick of incoming_snapshots.keys()) {
      if (tick < min_tick) {
        incoming_snapshots.delete(tick)
      }
    }
  }

  const inputs = get_resource(world, InputBuffer)
  if (inputs) {
    for (const tick of inputs.keys()) {
      if (tick < min_tick) {
        inputs.delete(tick)
      }
    }
  }

  const history = get_resource(world, HistoryBuffer)
  if (history) {
    const snapshots = history.snapshots
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
  const history = get_resource(world, HistoryBuffer)
  if (!history) return

  const incoming_transactions = get_resource(world, IncomingTransactions)
  if (!incoming_transactions) return

  let min_tick = Infinity
  for (const tick of incoming_transactions.keys()) {
    if (tick < world.tick) {
      min_tick = Math.min(min_tick, tick)
    }
  }

  if (min_tick === Infinity) return

  const original_tick = world.tick

  if (rollback_to_tick(world, history, min_tick)) {
    while (world.tick < original_tick) {
      run_schedule(schedule, world as World)
      commit_transaction(world)

      const transactions = incoming_transactions.get(world.tick)
      if (transactions) {
        for (const transaction of transactions) {
          apply_transaction(world, transaction)
        }
        world_flush_graph_changes(world)
        incoming_transactions.delete(world.tick)
      }

      if (world.tick < original_tick) {
        const next_tick = world.tick + 1
        const next_transactions = incoming_transactions.get(next_tick)
        const has_next_transaction =
          next_transactions && next_transactions.length > 0
        const is_checkpoint = next_tick % 5 === 0
        const is_last = next_tick === original_tick

        advance_tick(world, is_last || !(has_next_transaction || is_checkpoint))
      }
    }
  } else {
    const oldest_history_tick =
      history.snapshots.length > 0
        ? (history.snapshots[0] as Snapshot).tick
        : world.tick

    const sorted_ticks = Array.from(incoming_transactions.keys()).sort(
      (a, b) => a - b,
    )
    for (const tick of sorted_ticks) {
      if (tick < oldest_history_tick) {
        const transactions = incoming_transactions.get(tick)
        if (transactions) {
          for (const transaction of transactions) {
            apply_transaction(world, transaction)
          }
          world_flush_graph_changes(world)
          incoming_transactions.delete(tick)
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
    const incoming = get_resource(world, IncomingTransactions)
    if (!incoming) return
    const transactions = incoming.get(world.tick)
    if (transactions) {
      for (const transaction of transactions) {
        apply_transaction(world, transaction)
      }
      incoming.delete(world.tick)
    }
  },
  {params: [WorldTerm()], name: "apply_remote_transactions"},
)

export const apply_remote_snapshots = define_system(
  (world: World) => {
    const incoming = get_resource(world, IncomingSnapshots)
    if (!incoming) return
    const snapshots = incoming.get(world.tick)
    if (snapshots) {
      for (const snap of snapshots) {
        apply_snapshot_stream(world, snap)
      }
      incoming.delete(world.tick)
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
