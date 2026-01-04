import {World as WorldTerm} from "../query/term"
import {define_system} from "../system"
import type {World} from "../world"
import {world_flush_deletions, world_flush_graph_changes} from "../world_api"

export const GlomMonitors = {
  flush_changes: define_system(
    (world: World) => {
      world_flush_graph_changes(world)
    },
    {params: [WorldTerm()], name: "flush_changes"},
  ),

  flush_deletions: define_system(
    (world: World) => {
      world_flush_deletions(world)
    },
    {params: [WorldTerm()], name: "flush_deletions"},
  ),
}
