import type { AllDescriptor } from "../system_descriptor"
import type { Term, TermValue } from "./term"

export interface All<
  T0 extends Term = never,
  T1 extends Term = never,
  T2 extends Term = never,
  T3 extends Term = never,
  T4 extends Term = never,
  T5 extends Term = never,
  T6 extends Term = never,
  T7 extends Term = never,
> {
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
