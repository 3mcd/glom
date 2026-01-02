import type { ComponentLike } from "./component"
import type { EntityRegistry } from "./entity_registry"

export type World<R extends ComponentLike = never> = {
  readonly registry: EntityRegistry
  readonly __resources: (val: R) => void
}

export function make_world(): World<never> {
  return {} as World<never>
}

export function add_resource<T extends ComponentLike, U>(
  world: World<T>,
  _resource: U,
): asserts world is World<
  | T
  | (U extends { component: infer C }
      ? C extends ComponentLike
        ? C
        : never
      : never)
> {}
