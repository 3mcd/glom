import {pruneCommands} from "./command"
import {getDomainId} from "./entity"
import {type Checkpoint, HistoryBuffer, rollbackToTick} from "./history"
import type {SnapshotMessage} from "./net_types"
import {Read, World as WorldTerm} from "./query/term"
import {
  applyTransaction,
  TRANSIENT_DOMAIN,
  type Transaction,
} from "./replication"
import {
  IncomingSnapshots,
  IncomingTransactions,
  ReplicationConfig,
} from "./replication_config"
import {
  applySnapshotStream,
  applySnapshotStreamVersioned,
} from "./snapshot_stream"
import {defineSystem} from "./system"
import {runSchedule, type SystemSchedule} from "./system_schedule"
import type {World} from "./world"
import {getResource} from "./world"
import {
  advanceTick,
  commitTransaction,
  despawn,
  flushGraphChanges,
} from "./world_api"

export function receiveTransaction(world: World, transaction: Transaction) {
  const incoming = getResource(world, IncomingTransactions)
  if (incoming === undefined) return
  let list = incoming.get(transaction.tick)
  if (list === undefined) {
    list = []
    incoming.set(transaction.tick, list)
  }
  list.push(transaction)
}

export function receiveSnapshot(world: World, snapshot: SnapshotMessage) {
  const incoming = getResource(world, IncomingSnapshots)
  if (incoming === undefined) return
  let list = incoming.get(snapshot.tick)
  if (list === undefined) {
    list = []
    incoming.set(snapshot.tick, list)
  }
  list.push(snapshot)
}

export function resimulateWithTransactions(
  world: World,
  toTick: number,
  tickFn: (world: World) => void,
) {
  const fromTick = world.tick
  const incomingTransactions = getResource(world, IncomingTransactions)

  for (let t = fromTick; t < toTick; t++) {
    const transactions = incomingTransactions?.get(t)
    if (transactions !== undefined) {
      for (const transaction of transactions) {
        applyTransaction(world, transaction)
      }
      flushGraphChanges(world)
    }

    tickFn(world)

    commitTransaction(world)
    advanceTick(world)
  }
}

export function reconcileTransaction(
  world: World,
  transaction: Transaction,
  tickFn: (world: World) => void,
) {
  receiveTransaction(world, transaction)

  if (transaction.tick >= world.tick) {
    return
  }

  const history = getResource(world, HistoryBuffer)
  if (history === undefined) return

  const originalTick = world.tick
  if (rollbackToTick(world, history, transaction.tick)) {
    resimulateWithTransactions(world, originalTick, tickFn)
  } else {
    applyTransaction(world, transaction)
    flushGraphChanges(world)
    const incomingTransactions = getResource(world, IncomingTransactions)
    incomingTransactions?.delete(transaction.tick)
  }
}

export function pruneBuffers(world: World, minTick: number) {
  const incomingTransactions = getResource(world, IncomingTransactions)
  if (incomingTransactions !== undefined) {
    for (const tick of incomingTransactions.keys()) {
      if (tick < minTick) {
        incomingTransactions.delete(tick)
      }
    }
  }

  const incomingSnapshots = getResource(world, IncomingSnapshots)
  if (incomingSnapshots !== undefined) {
    for (const tick of incomingSnapshots.keys()) {
      if (tick < minTick) {
        incomingSnapshots.delete(tick)
      }
    }
  }

  const history = getResource(world, HistoryBuffer)
  if (history !== undefined) {
    // Prune old checkpoints
    while (history.checkpoints.length > 0) {
      const first = history.checkpoints[0]
      if (first && first.tick < minTick) {
        history.checkpoints.shift()
      } else {
        break
      }
    }

    // Prune old undo log entries
    while (history.undoLog.length > 0) {
      const first = history.undoLog[0]
      if (first && first.tick < minTick) {
        history.undoLog.shift()
      } else {
        break
      }
    }
  }

  pruneCommands(world, minTick)
}

export function performBatchReconciliation(
  world: World,
  schedule: SystemSchedule,
) {
  return performReconciliation(world, schedule)
}

export function performReconciliation(world: World, schedule: SystemSchedule) {
  const history = getResource(world, HistoryBuffer)
  if (history === undefined) return

  const config = getResource(world, ReplicationConfig)
  const applySnapshot =
    config?.snapshotStrategy === "versioned"
      ? applySnapshotStreamVersioned
      : applySnapshotStream

  const incomingTransactions = getResource(world, IncomingTransactions)
  const incomingSnapshots = getResource(world, IncomingSnapshots)

  // Determine the minimum tick across both transactions and snapshots
  let minTick = Infinity
  if (incomingTransactions !== undefined) {
    for (const tick of incomingTransactions.keys()) {
      if (tick < world.tick) {
        minTick = Math.min(minTick, tick)
      }
    }
  }
  if (incomingSnapshots !== undefined) {
    for (const tick of incomingSnapshots.keys()) {
      if (tick < world.tick) {
        minTick = Math.min(minTick, tick)
      }
    }
  }

  if (minTick === Infinity) return

  const originalTick = world.tick

  const rolledBack = rollbackToTick(world, history, minTick)

  if (rolledBack) {
    while (world.tick < originalTick) {
      // 1. Apply pending transactions at this tick (structural changes)
      if (incomingTransactions !== undefined) {
        const transactions = incomingTransactions.get(world.tick)
        if (transactions !== undefined) {
          for (const transaction of transactions) {
            applyTransaction(world, transaction)
          }
          incomingTransactions.delete(world.tick)
        }
      }
      flushGraphChanges(world)

      // 2. Run local prediction systems
      runSchedule(schedule, world as World)
      commitTransaction(world)

      // 3. Apply pending snapshots at this tick
      if (incomingSnapshots !== undefined) {
        const snapshots = incomingSnapshots.get(world.tick)
        if (snapshots !== undefined) {
          for (const snap of snapshots) {
            applySnapshot(world, snap)
          }
          incomingSnapshots.delete(world.tick)
        }
      }

      // 4. Advance tick
      if (world.tick < originalTick) {
        const isLast = world.tick + 1 === originalTick
        advanceTick(world, isLast)
      }
    }
  } else {
    const oldestCheckpointTick =
      history.checkpoints.length > 0
        ? (history.checkpoints[0] as Checkpoint).tick
        : world.tick

    // Apply transactions that arrived before the history window
    if (incomingTransactions !== undefined) {
      const sortedTicks = Array.from(incomingTransactions.keys()).sort(
        (a, b) => a - b,
      )
      let appliedAnyTransactions = false
      for (const tick of sortedTicks) {
        if (tick < oldestCheckpointTick) {
          const transactions = incomingTransactions.get(tick)
          if (transactions !== undefined) {
            for (const transaction of transactions) {
              applyTransaction(world, transaction)
            }
            flushGraphChanges(world)
            incomingTransactions.delete(tick)
            appliedAnyTransactions = true
          }
        } else {
          break
        }
      }
      if (appliedAnyTransactions) {
        history.checkpoints.length = 0
      }
    }

    // Apply snapshots that arrived before the history window (best effort)
    if (incomingSnapshots !== undefined) {
      const sortedTicks = Array.from(incomingSnapshots.keys()).sort(
        (a, b) => a - b,
      )
      for (const tick of sortedTicks) {
        if (tick < oldestCheckpointTick) {
          const snapshots = incomingSnapshots.get(tick)
          if (snapshots !== undefined) {
            for (const snap of snapshots) {
              applySnapshot(world, snap)
            }
          }
          incomingSnapshots.delete(tick)
        } else {
          break
        }
      }
    }
  }
}

export function cleanupTransientEntities(
  world: World,
  authoritativeTick: number,
) {
  for (const [key, info] of world.transients.entries()) {
    if (info.tick < authoritativeTick) {
      if (getDomainId(info.entity) === TRANSIENT_DOMAIN) {
        despawn(world, info.entity)
        console.log("despawned transient entity", info.entity)
      }

      world.transients.delete(key)
    }
  }
}

export const applyRemoteTransactions = defineSystem(
  (world: World) => {
    const incoming = getResource(world, IncomingTransactions)
    if (incoming === undefined) return
    for (const [tick, transactions] of incoming.entries()) {
      if (tick <= world.tick) {
        for (const transaction of transactions) {
          applyTransaction(world, transaction)
        }
        incoming.delete(tick)
      }
    }
  },
  {params: [WorldTerm()], name: "applyRemoteTransactions"},
)

export const applyRemoteSnapshots = defineSystem(
  (world: World) => {
    const incoming = getResource(world, IncomingSnapshots)
    if (incoming === undefined) return
    for (const [tick, snapshots] of incoming.entries()) {
      if (tick <= world.tick) {
        for (const snap of snapshots) {
          applySnapshotStream(world, snap)
        }
        incoming.delete(tick)
      }
    }
  },
  {params: [WorldTerm()], name: "applyRemoteSnapshots"},
)

/**
 * Like `applyRemoteSnapshots` but uses version-checked application.
 * Stale snapshots from slower peers will not overwrite newer local state.
 * Intended for P2P topologies.
 */
export const applyRemoteSnapshotsVersioned = defineSystem(
  (world: World) => {
    const incoming = getResource(world, IncomingSnapshots)
    if (incoming === undefined) return
    for (const [tick, snapshots] of incoming.entries()) {
      if (tick <= world.tick) {
        for (const snap of snapshots) {
          applySnapshotStreamVersioned(world, snap)
        }
        incoming.delete(tick)
      }
    }
  },
  {params: [WorldTerm()], name: "applyRemoteSnapshotsVersioned"},
)

export const performRollback = defineSystem(
  (config: Read<typeof ReplicationConfig>, world: World) => {
    if (config.reconcileSchedule === undefined) return
    performReconciliation(world, config.reconcileSchedule)
  },
  {
    params: [Read(ReplicationConfig), WorldTerm()],
    name: "performRollback",
  },
)

export const cleanupGhosts = defineSystem(
  (config: Read<typeof ReplicationConfig>, world: World) => {
    const window = config.ghostCleanupWindow ?? 60
    cleanupTransientEntities(world, world.tick - window)
  },
  {
    params: [Read(ReplicationConfig), WorldTerm()],
    name: "cleanupGhosts",
  },
)
