import type { Component, ComponentLike } from "../component"
import type { Entity } from "../entity"
export type { ComponentLike }

export type EntityTerm = { readonly entity: true }

export type TermValue<T extends Term> =
  T extends Read<infer U>
    ? U extends Component<infer V>
      ? Readonly<V>
      : never
    : T extends Write<infer U>
      ? U extends Component<infer V>
        ? V
        : never
      : T extends Component<infer V>
        ? V
        : T extends EntityTerm
          ? Entity
          : T extends Entity
            ? Entity
            : never

export interface Read<T extends ComponentLike> {
  readonly __read: T
  readonly value: TermValue<Read<T>>
}

export interface Write<T extends ComponentLike> {
  readonly __write: T
  readonly value: TermValue<Write<T>>
}

export type Term =
  | ComponentLike
  | Read<ComponentLike>
  | Write<ComponentLike>
  | EntityTerm
  | Entity
