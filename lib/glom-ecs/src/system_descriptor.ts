import type { All } from "./query/all"
import type { Read, Write } from "./query/term"
import type { SystemArgument } from "./system_argument"

type TermDescriptor<T> = T extends { readonly __read: infer U }
  ? { read: U }
  : T extends { readonly __write: infer U }
    ? { write: U }
    : T extends { readonly __rel: [infer R, infer U] }
      ? { rel: [R, TermDescriptor<U>] }
      : T extends number
        ? { entity: true }
        : T extends { readonly entity: true }
          ? { entity: true }
          : T extends { readonly __component_brand: true }
            ? { write: T } | { read: T }
            : never

type MapTerms<T> = T extends [infer Head, ...infer Tail]
  ? [TermDescriptor<Head>, ...MapTerms<Tail>]
  : []

type ParamsToTuple<T0, T1, T2, T3, T4, T5, T6, T7> = [T0] extends [never]
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
  T0,
  T1 = never,
  T2 = never,
  T3 = never,
  T4 = never,
  T5 = never,
  T6 = never,
  T7 = never,
> = {
  all: MapTerms<ParamsToTuple<T0, T1, T2, T3, T4, T5, T6, T7>>
}

type SystemParameterDescriptor<T> = T extends { __all: true }
  ? T extends All<
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
    : never
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
