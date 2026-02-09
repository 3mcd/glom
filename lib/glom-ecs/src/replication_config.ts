import {defineComponent, defineTag} from "./component"
import type {Transaction} from "./net_types"
import type {SystemSchedule} from "./system_schedule"

export const Replicated = defineTag(0)

export const ReplicationConfig = defineComponent<{
  historyWindow?: number
  ghostCleanupWindow?: number
  snapshotComponents?: number[]
  snapshotInterval?: number
  reconcileSchedule?: SystemSchedule
  /** When true, commitTransaction emits "set" ops for value-only changes (P2P). */
  emitValueTransactions?: boolean
  /** Controls snapshot application during reconciliation.
   *  "authoritative" (default): force-overwrite via forceSetComponentValue.
   *  "versioned": version-checked via setComponentValue (P2P). */
  snapshotStrategy?: "authoritative" | "versioned"
}>(
  {
    bytesPerElement: 0,
    encode: () => {},
    decode: () => ({}),
  },
  1,
)

export const ReplicationStream = defineComponent<{
  transactions: Transaction[]
  /** Pre-serialized snapshot packets (output of writeSnapshot). */
  snapshots: Uint8Array[]
}>(
  {
    bytesPerElement: 0,
    encode: () => {},
    decode: () => ({transactions: [], snapshots: []}),
  },
  2,
)

export const InputBuffer = defineComponent<Map<number, unknown>>(
  {
    bytesPerElement: 0,
    encode: () => {},
    decode: () => new Map(),
  },
  12,
)

export const IncomingTransactions = defineComponent<Map<number, Transaction[]>>(
  {
    bytesPerElement: 0,
    encode: () => {},
    decode: () => new Map(),
  },
  13,
)

export const IncomingSnapshots = defineComponent<
  Map<number, SnapshotMessage[]>
>(
  {
    bytesPerElement: 0,
    encode: () => {},
    decode: () => new Map(),
  },
  14,
)
