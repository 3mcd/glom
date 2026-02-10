import {defineComponent, defineTag} from "./component"
import type {SnapshotMessage, Transaction} from "./net_types"
import type {SystemSchedule} from "./system_schedule"

export const Replicated = defineTag("glom/Replicated", 0)

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
  "glom/ReplicationConfig",
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
  "glom/ReplicationStream",
  {
    bytesPerElement: 0,
    encode: () => {},
    decode: () => ({transactions: [], snapshots: []}),
  },
  2,
)

export const InputBuffer = defineComponent<Map<number, unknown>>(
  "glom/InputBuffer",
  {
    bytesPerElement: 0,
    encode: () => {},
    decode: () => new Map(),
  },
  12,
)

export const IncomingTransactions = defineComponent<Map<number, Transaction[]>>(
  "glom/IncomingTransactions",
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
  "glom/IncomingSnapshots",
  {
    bytesPerElement: 0,
    encode: () => {},
    decode: () => new Map(),
  },
  14,
)
