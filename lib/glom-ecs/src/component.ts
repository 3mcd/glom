import type {ByteReader, ByteWriter} from "./lib/binary"

export type ComponentEncode<T> = (value: T, writer: ByteWriter) => void

export type ComponentDecode<T> = (reader: ByteReader, value?: T) => T

export type ComponentSerde<T> = {
  encode: ComponentEncode<T>
  decode: ComponentDecode<T>
  bytesPerElement: number
}

export type ComponentInstance<T> = {
  readonly component: ComponentLike
  readonly value: T
}

export type ComponentLike = {
  readonly __component_brand: true
  readonly id?: number
  readonly isTag?: boolean
}

export type Component<T> = ComponentLike & {
  (value: T): ComponentInstance<T>
  serde?: ComponentSerde<T>
}

export type SerializedComponent<T> = Component<T> & {
  serde: ComponentSerde<T>
}

export interface ComponentResolver {
  getSerde(componentId: number): ComponentSerde<unknown> | undefined
  isTag(componentId: number): boolean
}

export function defineComponent<T>(
  serde?: ComponentSerde<T>,
  id?: number,
): Component<T> {
  const component = ((value: T): ComponentInstance<T> => ({
    component: component as unknown as ComponentLike,
    value,
  })) as unknown as Record<string, unknown>

  if (id !== undefined) component.id = id
  component.serde = serde
  component.__component_brand = true

  return component as unknown as Component<T>
}

export function defineTag(id?: number): Component<void> {
  const component = ((value: void): ComponentInstance<void> => ({
    component: component as unknown as ComponentLike,
    value,
  })) as unknown as Record<string, unknown>

  if (id !== undefined) component.id = id
  component.isTag = true
  component.__component_brand = true

  return component as unknown as Component<void>
}
