export type ComponentEncode<T> = (
  value: T,
  buffer: Uint8Array,
  offset: number,
) => void

export type ComponentDecode<T> = (
  buffer: Uint8Array,
  offset: number,
  value: T,
) => T

export type ComponentSerde<T> = {
  encode: ComponentEncode<T>
  decode: ComponentDecode<T>
  bytes_per_element: number
}

export type ComponentInstance<T> = {
  readonly component: ComponentLike
  readonly value: T
}

export type ComponentLike = {
  readonly __component_brand: true
  readonly id: number
  readonly is_tag?: boolean
}

export type Component<T> = ComponentLike & {
  (value: T): ComponentInstance<T>
  serde?: ComponentSerde<T>
}

export type SerializedComponent<T> = Component<T> & {
  serde: ComponentSerde<T>
}

export interface ComponentResolver {
  get_serde(component_id: number): ComponentSerde<unknown> | undefined
  is_tag(component_id: number): boolean
}

export function define_component<T>(
  id: number,
  serde?: ComponentSerde<T>,
): Component<T> {
  const component = ((value: T): ComponentInstance<T> => ({
    component: component as unknown as ComponentLike,
    value,
  })) as unknown as Record<string, unknown>

  component["id"] = id
  component["serde"] = serde
  component["__component_brand"] = true

  return component as unknown as Component<T>
}

export function define_tag(id: number): Component<void> {
  const component = ((value: void): ComponentInstance<void> => ({
    component: component as unknown as ComponentLike,
    value,
  })) as unknown as Record<string, unknown>

  component["id"] = id
  component["is_tag"] = true
  component["__component_brand"] = true

  return component as unknown as Component<void>
}
