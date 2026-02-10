import type {ComponentLike} from "./component"
import type {
  AddDescriptor,
  DespawnDescriptor,
  EntityDescriptor,
  HasDescriptor,
  InDescriptor,
  NotDescriptor,
  OutDescriptor,
  ReadDescriptor,
  RemoveDescriptor,
  SpawnDescriptor,
  WorldDescriptor,
  WriteDescriptor,
} from "./descriptors"
import type {All, In, Join, Out} from "./query/all"
import type {Has, Not, Read, Term, Write} from "./query/term"
import type {Relation} from "./relation"
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
    : T extends {readonly __read: infer _U}
      ? ReadDescriptor
      : T extends {readonly __write: infer _U}
        ? WriteDescriptor
        : T extends {readonly __has: infer U}
          ? HasDescriptor<U extends ComponentLike ? U : never>
          : T extends {readonly __not: infer U}
            ? NotDescriptor<U extends ComponentLike ? U : never>
            : T extends {readonly __spawn: infer U}
              ? SpawnDescriptor<U extends ComponentLike ? U : any>
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
                            ? ComponentLike | WriteDescriptor | ReadDescriptor
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
> = {
  all: MapTerms<ParamsToTuple<T0, T1, T2, T3, T4, T5, T6, T7>>
}

export type JoinDescriptor<L, R, Rel extends Relation | undefined> = {
  join: [L, R, Rel]
}

type SystemParameterDescriptor<T> =
  T extends In<
    infer T0,
    infer T1,
    infer T2,
    infer T3,
    infer T4,
    infer T5,
    infer T6,
    infer T7
  >
    ? InDescriptor<
        T0 extends Join<any, any, any>
          ? SystemParameterDescriptor<T0>
          : AllDescriptor<
              T0 extends Term ? T0 : never,
              T1,
              T2,
              T3,
              T4,
              T5,
              T6,
              T7
            >
      >
    : T extends Out<
          infer T0,
          infer T1,
          infer T2,
          infer T3,
          infer T4,
          infer T5,
          infer T6,
          infer T7
        >
      ? OutDescriptor<
          T0 extends Join<any, any, any>
            ? SystemParameterDescriptor<T0>
            : AllDescriptor<
                T0 extends Term ? T0 : never,
                T1,
                T2,
                T3,
                T4,
                T5,
                T6,
                T7
              >
        >
      : T extends Join<infer L, infer R, infer Rel>
        ? JoinDescriptor<
            SystemParameterDescriptor<L>,
            SystemParameterDescriptor<R>,
            Rel
          >
        : T extends All<
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
          : T extends WorldType
            ? WorldDescriptor
            : T extends Spawn<infer U>
              ? SpawnDescriptor<U extends ComponentLike ? U : any>
              : T extends Despawn
                ? DespawnDescriptor
                : T extends Add<infer U>
                  ? AddDescriptor<U extends ComponentLike ? U : never>
                  : T extends Remove<infer U>
                    ? RemoveDescriptor<U extends ComponentLike ? U : never>
                    : T extends Read<infer _U>
                      ? ReadDescriptor
                      : T extends Write<infer _U>
                        ? WriteDescriptor
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

export const systemDescriptorKey = "__system_desc"
