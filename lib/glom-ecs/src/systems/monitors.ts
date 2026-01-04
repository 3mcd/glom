import {World as WorldTerm} from "../query/term"
import {define_system} from "../system"
import type {World} from "../world"
import {world_flush_deletions, world_flush_graph_changes} from "../world_api"

export const GlomMonitors = {
  /**
   * System: Flush Graph Changes
   * Flushes graph changes from the previous tick and triggers monitor events.
   * Should be called at the very START of the frame.
   */
  flush_changes: define_system(
    (world: World) => {
      world_flush_graph_changes(world)
    },
    {params: [WorldTerm()], name: "flush_changes"},
  ),

  /**
   * System: Flush Deletions
   * Actually clears component storage for deferred deletions.
   * Should be called at the very END of the frame, after all systems have
   * had a chance to react to transitions.
   */
  flush_deletions: define_system(
    (world: World) => {
      world_flush_deletions(world)
    },
    {params: [WorldTerm()], name: "flush_deletions"},
  ),
}
