import type { ComponentLike } from "./component"
import type { All } from "./query/all"
import type { Read, Term, Write } from "./query/term"
import type { SystemArgument } from "./system_argument"

type TermDescriptor<T extends Term> =
  T extends Read<infer U>
    ? { read: U }
    : T extends Write<infer U>
      ? { write: U }
      : T extends ComponentLike
        ? { write: T } | { read: T }
        : never

type MapTerms<T extends unknown[]> = {
  [K in keyof T]: T[K] extends Term ? TermDescriptor<T[K]> : never
}

type ParamsToTuple<
  T0 extends Term,
  T1 extends Term,
  T2 extends Term,
  T3 extends Term,
  T4 extends Term,
  T5 extends Term,
  T6 extends Term,
  T7 extends Term,
> = [T0] extends [never]
  ? []
  : [T1] extends [never]
    ? [T0]
    : [T2] extends [never]
      ? [T0, T1]
      : [T3] extends [never]
        ? [T0, T1, T2]
        : [T4] extends [never]
          ? [T0, T1, T2, T3]
          : [T5] extends [never]
            ? [T0, T1, T2, T3, T4]
            : [T6] extends [never]
              ? [T0, T1, T2, T3, T4, T5]
              : [T7] extends [never]
                ? [T0, T1, T2, T3, T4, T5, T6]
                : [T0, T1, T2, T3, T4, T5, T6, T7]

export type AllDescriptor<
  T0 extends Term,
  T1 extends Term,
  T2 extends Term,
  T3 extends Term,
  T4 extends Term,
  T5 extends Term,
  T6 extends Term,
  T7 extends Term,
> = {
  all: MapTerms<ParamsToTuple<T0, T1, T2, T3, T4, T5, T6, T7>>
}

type SystemParameterDescriptor<T> =
  T extends All<
    infer T0,
    infer T1,
    infer T2,
    infer T3,
    infer T4,
    infer T5,
    infer T6,
    infer T7
  >
    ? AllDescriptor<T0, T1, T2, T3, T4, T5, T6, T7>
    : T extends Read<infer U>
      ? { read: U }
      : T extends Write<infer U>
        ? { write: U }
        : never

type SystemParametersDescriptor<T extends SystemArgument[]> = {
  [K in keyof T]: SystemParameterDescriptor<T[K]>
}

export type SystemDescriptor<T extends SystemArgument[]> = {
  params: SystemParametersDescriptor<T>
}

export const system_descriptor_key = "__system_desc"
