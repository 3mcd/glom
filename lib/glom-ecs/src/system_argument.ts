import type { All } from "./query/all"
import type { ComponentLike, Read, Term, Write } from "./query/term"

export type SystemArgument =
  | All<Term, Term, Term, Term, Term, Term, Term, Term>
  | Read<ComponentLike>
  | Write<ComponentLike>
