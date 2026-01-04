import type {ComponentLike} from "./component"
import type {AnyAll, In, Out} from "./query/all"
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
  | In<AnyAll>
  | Out<AnyAll>
  | Read<ComponentLike>
  | Write<ComponentLike>
  | Has<ComponentLike>
  | Not<ComponentLike>
  | World
  | Spawn
  | Despawn
  | Add<ComponentLike>
  | Remove<ComponentLike>
