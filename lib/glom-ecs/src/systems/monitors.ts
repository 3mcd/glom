import {World as WorldTerm} from "../query/term"
import {defineSystem} from "../system"
import type {World} from "../world"
import {worldFlushDeletions, worldFlushGraphChanges} from "../world_api"

export const GlomMonitors = {
  flushChanges: defineSystem(
    (world: World) => {
      worldFlushGraphChanges(world)
    },
    {params: [WorldTerm()], name: "flushChanges"},
  ),

  flushDeletions: defineSystem(
    (world: World) => {
      worldFlushDeletions(world)
    },
    {params: [WorldTerm()], name: "flushDeletions"},
  ),
}
