import {define_component, define_tag} from "./component"
import type {SnapshotMessage, Transaction} from "./net_types"
import type {SystemSchedule} from "./system_schedule"

export const Replicated = define_tag(0)

export const ReplicationConfig = define_component<{
  history_window?: number
  ghost_cleanup_window?: number
  snapshot_components?: number[]
  simulation_schedule?: SystemSchedule
}>(
  {
    bytes_per_element: 0,
    encode: () => {},
    decode: () => ({}),
  },
  1,
)

export const ReplicationStream = define_component<{
  transactions: Transaction[]
  snapshots: SnapshotMessage[]
}>(
  {
    bytes_per_element: 0,
    encode: () => {},
    decode: () => ({transactions: [], snapshots: []}),
  },
  2,
)

export const InputBuffer = define_component<Map<number, unknown>>(
  {
    bytes_per_element: 0,
    encode: () => {},
    decode: () => new Map(),
  },
  12,
)

export const IncomingTransactions = define_component<Map<number, Transaction[]>>(
  {
    bytes_per_element: 0,
    encode: () => {},
    decode: () => new Map(),
  },
  13,
)

export const IncomingSnapshots = define_component<
  Map<number, SnapshotMessage[]>
>(
  {
    bytes_per_element: 0,
    encode: () => {},
    decode: () => new Map(),
  },
  14,
)
