import {World as WorldTerm} from "../query/term"
import {defineSystem} from "../system"
import type {World} from "../world"
import {flushDeletions, flushGraphChanges} from "../world_api"

export const GlomMonitors = {
  flushChanges: defineSystem(
    (world: World) => {
      flushGraphChanges(world)
    },
    {params: [WorldTerm()], name: "flushChanges"},
  ),

  flushDeletions: defineSystem(
    (world: World) => {
      flushDeletions(world)
    },
    {params: [WorldTerm()], name: "flushDeletions"},
  ),
}
