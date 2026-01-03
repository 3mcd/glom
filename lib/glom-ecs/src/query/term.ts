import type { Component, ComponentLike } from "../component"
import type {
  HasDescriptor,
  NotDescriptor,
  ReadDescriptor,
  RelDescriptor,
  WriteDescriptor,
} from "../descriptors"
import type { Entity } from "../entity"
import type { Relation } from "../relation"
export type { ComponentLike }

export type EntityTerm = { readonly entity: true }

export type Read<T extends ComponentLike> =
  T extends Component<void>
    ? never
    : (T extends Component<infer V> ? Readonly<V> : unknown) & {
        readonly __read: T
      }

export type Write<T extends ComponentLike> =
  T extends Component<infer V>
    ? V extends object
      ? V & { readonly __write: T }
      : never
    : unknown & { readonly __write: T }

export interface Has<T extends ComponentLike> {
  readonly __has: T
}

export interface Not<T extends ComponentLike> {
  readonly __not: T
}

export interface Rel<R extends Relation, T extends Term> {
  readonly __rel: [R, T]
}

export type TermValue<T extends Term> =
  T extends Read<infer U>
    ? U extends Component<infer V>
      ? Readonly<V>
      : never
    : T extends Write<infer U>
      ? U extends Component<infer V>
        ? V
        : never
      : T extends Has<ComponentLike>
        ? void
        : T extends Not<ComponentLike>
          ? void
          : T extends Rel<Relation, infer U>
            ? TermValue<U>
            : T extends Component<infer V>
              ? V
              : T extends EntityTerm
                ? Entity
                : T extends Entity
                  ? Entity
                  : never

export type Term =
  | ComponentLike
  | { readonly __read: ComponentLike }
  | { readonly __write: ComponentLike }
  | { readonly __has: ComponentLike }
  | { readonly __not: ComponentLike }
  | { readonly __rel: [Relation, unknown] }
  | EntityTerm
  | Entity

export function Read<T extends ComponentLike>(
  component: T,
): ReadDescriptor<T extends Component<infer V> ? V : unknown> {
  return { read: component } as unknown as ReadDescriptor<
    T extends Component<infer V> ? V : unknown
  >
}

export function Write<T extends ComponentLike>(
  component: T,
): WriteDescriptor<T extends Component<infer V> ? V : unknown> {
  return { write: component } as unknown as WriteDescriptor<
    T extends Component<infer V> ? V : unknown
  >
}

export function Has<T extends ComponentLike>(component: T): HasDescriptor<T> {
  return { has: component } as unknown as HasDescriptor<T>
}

export function Not<T extends ComponentLike>(component: T): NotDescriptor<T> {
  return { not: component } as unknown as NotDescriptor<T>
}

export function Rel<R extends Relation, T>(
  relation: R,
  object: T,
): RelDescriptor<R, T>
export function Rel<R extends Relation>(relation: R): RelDescriptor<R, R>
export function Rel<R extends Relation, T>(
  relation: R,
  object?: T,
): RelDescriptor<R, T | R> {
  return { rel: [relation, object ?? relation] } as unknown as RelDescriptor<
    R,
    T | R
  >
}
