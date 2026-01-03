import type { AllDescriptor } from "../descriptors"
import type { Term, TermValue } from "./term"

export interface AnyAll {
  readonly __all: true
  readonly desc: AllDescriptor
  [Symbol.iterator](): Iterator<unknown[]>
}

export interface All<
  T0 extends Term = never,
  T1 extends Term = never,
  T2 extends Term = never,
  T3 extends Term = never,
  T4 extends Term = never,
  T5 extends Term = never,
  T6 extends Term = never,
  T7 extends Term = never,
> extends AnyAll {
  readonly desc: AllDescriptor<T0, T1, T2, T3, T4, T5, T6, T7>
  [Symbol.iterator](): Iterator<
    [
      TermValue<T0>,
      TermValue<T1>,
      TermValue<T2>,
      TermValue<T3>,
      TermValue<T4>,
      TermValue<T5>,
      TermValue<T6>,
      TermValue<T7>,
    ]
  >
}

export function All<T extends unknown[]>(...terms: T): { all: T } {
  return { all: terms }
}

export function is_all(val: unknown): val is AnyAll {
  return typeof val === "object" && val !== null && "__all" in val
}
