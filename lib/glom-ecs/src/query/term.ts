import type { Component, ComponentLike } from "../component"
import type { Entity } from "../entity"
import type { Relationship } from "../relation"
export type { ComponentLike }

export type EntityTerm = { readonly entity: true }

export type Read<T extends ComponentLike> = (T extends Component<infer V>
  ? Readonly<V>
  : unknown) & { readonly __read: T }

export type Write<T extends ComponentLike> = (T extends Component<infer V>
  ? V
  : unknown) & { readonly __write: T }

export interface Rel<R extends Relationship, T extends Term> {
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
      : T extends Rel<Relationship, infer U>
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
  | Read<ComponentLike>
  | Write<ComponentLike>
  | Rel<Relationship, unknown>
  | EntityTerm
  | Entity
