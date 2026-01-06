import type {
  AllDescriptor,
  InDescriptor,
  OutDescriptor,
  UniqueDescriptor,
} from "../descriptors"
import type {EntityGraphNode} from "../entity_graph"
import type {Term, TermValue} from "./term"

export type Join = {
  readonly nodes: EntityGraphNode[]
  readonly joinOn?: {readonly id: number}
}

export interface AnyAll {
  readonly __all: true
  readonly desc: AllDescriptor | InDescriptor | OutDescriptor | UniqueDescriptor
  readonly stores: unknown[][]
  readonly joins: Join[]
  readonly entityToIndex: {
    readonly sparse: Map<number, number>
    readonly dense: number[]
  }
  [Symbol.iterator](): Iterator<unknown[]>
}

export type AllIterator<
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
    ? [TermValue<T0>]
    : [T2] extends [never]
      ? [TermValue<T0>, TermValue<T1>]
      : [T3] extends [never]
        ? [TermValue<T0>, TermValue<T1>, TermValue<T2>]
        : [T4] extends [never]
          ? [TermValue<T0>, TermValue<T1>, TermValue<T2>, TermValue<T3>]
          : [T5] extends [never]
            ? [
                TermValue<T0>,
                TermValue<T1>,
                TermValue<T2>,
                TermValue<T3>,
                TermValue<T4>,
              ]
            : [T6] extends [never]
              ? [
                  TermValue<T0>,
                  TermValue<T1>,
                  TermValue<T2>,
                  TermValue<T3>,
                  TermValue<T4>,
                  TermValue<T5>,
                ]
              : [T7] extends [never]
                ? [
                    TermValue<T0>,
                    TermValue<T1>,
                    TermValue<T2>,
                    TermValue<T3>,
                    TermValue<T4>,
                    TermValue<T5>,
                    TermValue<T6>,
                  ]
                : [
                    TermValue<T0>,
                    TermValue<T1>,
                    TermValue<T2>,
                    TermValue<T3>,
                    TermValue<T4>,
                    TermValue<T5>,
                    TermValue<T6>,
                    TermValue<T7>,
                  ]

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
  [Symbol.iterator](): Iterator<AllIterator<T0, T1, T2, T3, T4, T5, T6, T7>>
}

export function All<T extends unknown[]>(...terms: T): {all: T} {
  return {all: terms}
}

export function isAll(val: unknown): val is AnyAll {
  return typeof val === "object" && val !== null && "__all" in val
}

export function isUnique(val: unknown): val is Unique<any> {
  return typeof val === "object" && val !== null && "__unique" in val
}

export interface In<
  T0 extends Term = never,
  T1 extends Term = never,
  T2 extends Term = never,
  T3 extends Term = never,
  T4 extends Term = never,
  T5 extends Term = never,
  T6 extends Term = never,
  T7 extends Term = never,
> extends AnyAll {
  readonly __in: true
  readonly desc: InDescriptor<AllDescriptor<T0, T1, T2, T3, T4, T5, T6, T7>>
  [Symbol.iterator](): Iterator<AllIterator<T0, T1, T2, T3, T4, T5, T6, T7>>
}

export interface Out<
  T0 extends Term = never,
  T1 extends Term = never,
  T2 extends Term = never,
  T3 extends Term = never,
  T4 extends Term = never,
  T5 extends Term = never,
  T6 extends Term = never,
  T7 extends Term = never,
> extends AnyAll {
  readonly __out: true
  readonly desc: OutDescriptor<AllDescriptor<T0, T1, T2, T3, T4, T5, T6, T7>>
  [Symbol.iterator](): Iterator<AllIterator<T0, T1, T2, T3, T4, T5, T6, T7>>
}

export function In<T extends unknown[]>(...terms: T): {in: {all: T}} {
  return {in: {all: terms}}
}

export function Out<T extends unknown[]>(...terms: T): {out: {all: terms}} {
  return {out: {all: terms}}
}

export type UniqueIterator<
  T0 extends Term,
  T1 extends Term,
  T2 extends Term,
  T3 extends Term,
  T4 extends Term,
  T5 extends Term,
  T6 extends Term,
  T7 extends Term,
> = [T1] extends [never]
  ? TermValue<T0>
  : AllIterator<T0, T1, T2, T3, T4, T5, T6, T7>

export interface Unique<
  T0 extends Term = never,
  T1 extends Term = never,
  T2 extends Term = never,
  T3 extends Term = never,
  T4 extends Term = never,
  T5 extends Term = never,
  T6 extends Term = never,
  T7 extends Term = never,
> extends AnyAll {
  readonly __unique: true
  readonly desc: UniqueDescriptor<T0, T1, T2, T3, T4, T5, T6, T7>
  get(): UniqueIterator<T0, T1, T2, T3, T4, T5, T6, T7>
  [Symbol.iterator](): Iterator<AllIterator<T0, T1, T2, T3, T4, T5, T6, T7>>
}

export function Unique<T extends unknown[]>(...terms: T): {unique: T} {
  return {unique: terms}
}
