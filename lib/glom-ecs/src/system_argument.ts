import type { ComponentLike } from "./component"
import type { AnyAll } from "./query/all"
import type { Has, Not, Read, Write } from "./query/term"

export type SystemArgument =
  | AnyAll
  | Read<ComponentLike>
  | Write<ComponentLike>
  | Has<ComponentLike>
  | Not<ComponentLike>
