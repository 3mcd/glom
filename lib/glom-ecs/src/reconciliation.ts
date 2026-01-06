import {pruneCommands} from "./command"
import {getDomainId} from "./entity"
import {HistoryBuffer, rollbackToTick, type Snapshot} from "./history"
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
  InputBuffer,
  ReplicationConfig,
} from "./replication_config"
import {applySnapshotStream} from "./snapshot_stream"
import {defineSystem} from "./system"
import {runSchedule, type SystemSchedule} from "./system_schedule"
import type {World} from "./world"
import {addResource, getResource} from "./world"
import {
  advanceTick,
  commitTransaction,
  despawn,
  worldFlushGraphChanges,
} from "./world_api"

export function receiveTransaction(world: World, transaction: Transaction) {
  const incoming = getResource(world, IncomingTransactions)
  if (!incoming) return
  let list = incoming.get(transaction.tick)
  if (!list) {
    list = []
    incoming.set(transaction.tick, list)
  }
  list.push(transaction)
}

export function receiveSnapshot(world: World, snapshot: SnapshotMessage) {
  const incoming = getResource(world, IncomingSnapshots)
  if (!incoming) return
  let list = incoming.get(snapshot.tick)
  if (!list) {
    list = []
    incoming.set(snapshot.tick, list)
  }
  list.push(snapshot)
}

export function resimulateWithTransactions(
  world: World,
  toTick: number,
  tickFn: (world: World, input: unknown) => void,
) {
  const fromTick = world.tick
  const incomingTransactions = getResource(world, IncomingTransactions)
  const inputs = getResource(world, InputBuffer)

  for (let t = fromTick; t < toTick; t++) {
    const transactions = incomingTransactions?.get(t)
    if (transactions) {
      for (const transaction of transactions) {
        applyTransaction(world, transaction)
      }
      worldFlushGraphChanges(world)
    }

    const input = inputs?.get(t + 1)
    tickFn(world, input)

    commitTransaction(world)
    advanceTick(world)
  }
}

export function reconcileTransaction(
  world: World,
  transaction: Transaction,
  tickFn: (world: World, input: unknown) => void,
) {
  receiveTransaction(world, transaction)

  if (transaction.tick >= world.tick) {
    return
  }

  const history = getResource(world, HistoryBuffer)
  if (!history) return

  const originalTick = world.tick
  if (rollbackToTick(world, history, transaction.tick)) {
    resimulateWithTransactions(world, originalTick, tickFn)
  } else {
    applyTransaction(world, transaction)
    worldFlushGraphChanges(world)
    const incomingTransactions = getResource(world, IncomingTransactions)
    incomingTransactions?.delete(transaction.tick)
  }
}

export function pruneBuffers(world: World, minTick: number) {
  const incomingTransactions = getResource(world, IncomingTransactions)
  if (incomingTransactions) {
    for (const tick of incomingTransactions.keys()) {
      if (tick < minTick) {
        incomingTransactions.delete(tick)
      }
    }
  }

  const incomingSnapshots = getResource(world, IncomingSnapshots)
  if (incomingSnapshots) {
    for (const tick of incomingSnapshots.keys()) {
      if (tick < minTick) {
        incomingSnapshots.delete(tick)
      }
    }
  }

  const inputs = getResource(world, InputBuffer)
  if (inputs) {
    for (const tick of inputs.keys()) {
      if (tick < minTick) {
        inputs.delete(tick)
      }
    }
  }

  const history = getResource(world, HistoryBuffer)
  if (history) {
    const snapshots = history.snapshots
    while (snapshots.length > 0) {
      const first = snapshots[0]
      if (first && first.tick < minTick) {
        snapshots.shift()
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
  const history = getResource(world, HistoryBuffer)
  if (!history) return

  const incomingTransactions = getResource(world, IncomingTransactions)
  if (!incomingTransactions) return

  let minTick = Infinity
  for (const tick of incomingTransactions.keys()) {
    if (tick < world.tick) {
      minTick = Math.min(minTick, tick)
    }
  }

  if (minTick === Infinity) return

  const originalTick = world.tick

  if (rollbackToTick(world, history, minTick)) {
    while (world.tick < originalTick) {
      runSchedule(schedule, world as World)
      commitTransaction(world)

      const transactions = incomingTransactions.get(world.tick)
      if (transactions) {
        for (const transaction of transactions) {
          applyTransaction(world, transaction)
        }
        worldFlushGraphChanges(world)
        incomingTransactions.delete(world.tick)
      }

      if (world.tick < originalTick) {
        const nextTick = world.tick + 1
        const nextTransactions = incomingTransactions.get(nextTick)
        const hasNextTransaction =
          nextTransactions && nextTransactions.length > 0
        const isCheckpoint = nextTick % 5 === 0
        const isLast = nextTick === originalTick

        advanceTick(world, isLast || !(hasNextTransaction || isCheckpoint))
      }
    }
  } else {
    const oldestHistoryTick =
      history.snapshots.length > 0
        ? (history.snapshots[0] as Snapshot).tick
        : world.tick

    const sortedTicks = Array.from(incomingTransactions.keys()).sort(
      (a, b) => a - b,
    )
    for (const tick of sortedTicks) {
      if (tick < oldestHistoryTick) {
        const transactions = incomingTransactions.get(tick)
        if (transactions) {
          for (const transaction of transactions) {
            applyTransaction(world, transaction)
          }
          worldFlushGraphChanges(world)
          incomingTransactions.delete(tick)
        }
      } else {
        break
      }
    }
  }
}

export function cleanupTransientEntities(
  world: World,
  authoritativeTick: number,
) {
  for (const [key, info] of world.transientRegistry.entries()) {
    if (info.tick < authoritativeTick) {
      if (getDomainId(info.entity) === TRANSIENT_DOMAIN) {
        despawn(world, info.entity)
      }

      world.transientRegistry.delete(key)
    }
  }
}

export const applyRemoteTransactions = defineSystem(
  (world: World) => {
    const incoming = getResource(world, IncomingTransactions)
    if (!incoming) return
    const transactions = incoming.get(world.tick)
    if (transactions) {
      for (const transaction of transactions) {
        applyTransaction(world, transaction)
      }
      incoming.delete(world.tick)
    }
  },
  {params: [WorldTerm()], name: "applyRemoteTransactions"},
)

export const applyRemoteSnapshots = defineSystem(
  (world: World) => {
    const incoming = getResource(world, IncomingSnapshots)
    if (!incoming) return
    const snapshots = incoming.get(world.tick)
    if (snapshots) {
      for (const snap of snapshots) {
        applySnapshotStream(world, snap)
      }
      incoming.delete(world.tick)
    }
  },
  {params: [WorldTerm()], name: "applyRemoteSnapshots"},
)

export const performRollback = defineSystem(
  (config: Read<typeof ReplicationConfig>, world: World) => {
    if (!config.reconcileSchedule) return
    performBatchReconciliation(world, config.reconcileSchedule)
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
