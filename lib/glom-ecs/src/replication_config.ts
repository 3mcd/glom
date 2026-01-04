import {
  define_component,
  define_tag,
} from "./component"
import type { SystemSchedule } from "./system_schedule"

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

