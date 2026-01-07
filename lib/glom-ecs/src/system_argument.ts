import type {ComponentLike} from "./component"
import type {AnyAll, Join} from "./query/all"
import type {
  Add,
  Despawn,
  Has,
  Not,
  Read,
  Remove,
  Spawn,
  Write,
} from "./query/term"
import type {World} from "./world"

export type {Add, Despawn, Remove, Spawn}

export type SystemArgument =
  | AnyAll
  | Join<any, any, any>
  | Read<ComponentLike>
  | Write<ComponentLike>
  | Has<ComponentLike>
  | Not<ComponentLike>
  | World
  | Spawn<any>
  | Despawn
  | Add<ComponentLike>
  | Remove<ComponentLike>
