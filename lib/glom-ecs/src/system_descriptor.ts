import type {Component, ComponentLike} from "./component"
import type {
  AddDescriptor,
  DespawnDescriptor,
  EntityDescriptor,
  HasDescriptor,
  InDescriptor,
  NotDescriptor,
  OutDescriptor,
  AllDescriptor as RawAllDescriptor,
  ReadDescriptor,
  RemoveDescriptor,
  SpawnDescriptor,
  WorldDescriptor,
  WriteDescriptor,
} from "./descriptors"
import type {All} from "./query/all"
import type {Has, Not, Read, Write} from "./query/term"
import type {
  Add,
  Despawn,
  Remove,
  Spawn,
  SystemArgument,
} from "./system_argument"
import type {World as WorldType} from "./world"

export * from "./descriptors"

type TermDescriptor<T> = [T] extends [never]
  ? never
  : T extends WorldType
    ? WorldDescriptor
    : T extends {readonly __read: infer U}
      ? ReadDescriptor<U extends Component<infer V> ? V : unknown>
      : T extends {readonly __write: infer U}
        ? WriteDescriptor<U extends Component<infer V> ? V : unknown>
        : T extends {readonly __has: infer U}
          ? HasDescriptor<U extends ComponentLike ? U : never>
          : T extends {readonly __not: infer U}
            ? NotDescriptor<U extends ComponentLike ? U : never>
            : T extends {readonly __spawn: true}
              ? SpawnDescriptor
              : T extends {readonly __despawn: true}
                ? DespawnDescriptor
                : T extends {readonly __add: infer U}
                  ? AddDescriptor<U extends ComponentLike ? U : never>
                  : T extends {readonly __remove: infer U}
                    ? RemoveDescriptor<U extends ComponentLike ? U : never>
                    : T extends {readonly __rel: [infer R, infer U]}
                      ? {rel: [R, TermDescriptor<U>]}
                      : T extends number
                        ? EntityDescriptor
                        : T extends {readonly entity: true}
                          ? EntityDescriptor
                          : T extends {readonly __component_brand: true}
                            ?
                                | WriteDescriptor<
                                    T extends Component<infer V> ? V : unknown
                                  >
                                | ReadDescriptor<
                                    T extends Component<infer V> ? V : unknown
                                  >
                            : unknown

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
> = RawAllDescriptor & {
  all: MapTerms<ParamsToTuple<T0, T1, T2, T3, T4, T5, T6, T7>>
}

type SystemParameterDescriptor<T> = T extends {__all: true}
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
  : T extends {readonly __in: infer U}
    ? U extends All<
        infer T0,
        infer T1,
        infer T2,
        infer T3,
        infer T4,
        infer T5,
        infer T6,
        infer T7
      >
      ? InDescriptor<AllDescriptor<T0, T1, T2, T3, T4, T5, T6, T7>>
      : never
    : T extends {readonly __out: infer U}
      ? U extends All<
          infer T0,
          infer T1,
          infer T2,
          infer T3,
          infer T4,
          infer T5,
          infer T6,
          infer T7
        >
        ? OutDescriptor<AllDescriptor<T0, T1, T2, T3, T4, T5, T6, T7>>
        : never
      : T extends WorldType
        ? WorldDescriptor
        : T extends Spawn
          ? SpawnDescriptor
          : T extends Despawn
            ? DespawnDescriptor
            : T extends Add<infer U>
              ? AddDescriptor<U extends ComponentLike ? U : never>
              : T extends Remove<infer U>
                ? RemoveDescriptor<U extends ComponentLike ? U : never>
                : T extends Read<infer U>
                  ? ReadDescriptor<U extends Component<infer V> ? V : unknown>
                  : T extends Write<infer U>
                    ? WriteDescriptor<
                        U extends Component<infer V> ? V : unknown
                      >
                    : T extends Has<infer U>
                      ? HasDescriptor<U extends ComponentLike ? U : never>
                      : T extends Not<infer U>
                        ? NotDescriptor<U extends ComponentLike ? U : never>
                        : never

type SystemParametersDescriptor<T extends SystemArgument[]> = {
  [K in keyof T]: SystemParameterDescriptor<T[K]>
}

export type SystemDescriptor<T extends SystemArgument[]> = {
  params: SystemParametersDescriptor<T>
  name?: string
}

export const system_descriptor_key = "__system_desc"
