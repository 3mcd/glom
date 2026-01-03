import type { ComponentLike } from "./component"
import type { AnyAll } from "./query/all"
import type { Has, Read, Write } from "./query/term"

export type SystemArgument =
  | AnyAll
  | Read<ComponentLike>
  | Write<ComponentLike>
  | Has<ComponentLike>
