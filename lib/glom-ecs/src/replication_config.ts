import * as Component from "./component"
import type {SnapshotMessage, Transaction} from "./net_types"
import type {SystemSchedule} from "./system_schedule"

export const Replicated = Component.defineTag("glom/Replicated")

export const ReplicationConfig = Component.define<{
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
}>("glom/ReplicationConfig", {
  bytesPerElement: 0,
  encode: () => {},
  decode: () => ({}),
})

export const ReplicationStream = Component.define<{
  transactions: Transaction[]
  /** Pre-serialized snapshot packets (output of writeSnapshot). */
  snapshots: Uint8Array[]
}>("glom/ReplicationStream", {
  bytesPerElement: 0,
  encode: () => {},
  decode: () => ({transactions: [], snapshots: []}),
})

export const IncomingTransactions = Component.define<Map<number, Transaction[]>>(
  "glom/IncomingTransactions",
  {
    bytesPerElement: 0,
    encode: () => {},
    decode: () => new Map(),
  },
)

export const IncomingSnapshots = Component.define<
  Map<number, SnapshotMessage[]>
>("glom/IncomingSnapshots", {
  bytesPerElement: 0,
  encode: () => {},
  decode: () => new Map(),
})
