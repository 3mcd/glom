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
  component: Component<T>
  value: T
}

export type ComponentLike = { readonly __component_brand: true }

export type Component<T> = ComponentLike & {
  (value: T): ComponentInstance<T>
  id: number
  serde?: ComponentSerde<T>
}

export type SerializedComponent<T> = Component<T> & {
  serde: ComponentSerde<T>
}

type EditableComponent<T> = Component<T> & {
  __component_brand: true
}

export function define_component<T>(
  id: number,
  serde?: ComponentSerde<T>,
): Component<T> {
  const component = ((value: T): ComponentInstance<T> => ({
    component: component as Component<T>,
    value,
  })) as EditableComponent<T>

  component.id = id
  component.serde = serde
  component.__component_brand = true

  return component as Component<T>
}
