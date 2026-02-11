import {World as WorldTerm} from "../query/term"
import * as System from "../system"
import type {World} from "../world"
import {flushDeletions, flushGraphChanges} from "../world_api"

export const GlomMonitors = {
  flushChanges: System.define(
    (world: World) => {
      flushGraphChanges(world)
    },
    {params: [WorldTerm()], name: "flushChanges"},
  ),

  flushDeletions: System.define(
    (world: World) => {
      flushDeletions(world)
    },
    {params: [WorldTerm()], name: "flushDeletions"},
  ),
}
