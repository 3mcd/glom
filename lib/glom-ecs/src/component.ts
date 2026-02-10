import type {ByteReader, ByteWriter} from "./lib/binary"
import {hashNameToComponentId} from "./lib/hash"

export type ComponentEncode<T> = (value: T, writer: ByteWriter) => void

export type ComponentDecode<T> = (reader: ByteReader, value?: T) => T

export type ComponentSerde<T> = {
  encode: ComponentEncode<T>
  decode: ComponentDecode<T>
  bytesPerElement: number
}

/**
 * Global serde registry, populated at defineComponent/defineTag/defineRelation
 * time (module scope).  The protocol layer falls back to this when a
 * per-world registry hasn't registered a component yet, avoiding the need
 * for eager setup before deserialising network packets.
 */
const globalComponentInfo = new Map<
  number,
  {serde?: ComponentSerde<unknown>; isTag: boolean}
>()

/** @internal */
export function getGlobalComponentSerde(
  id: number,
): ComponentSerde<unknown> | undefined {
  return globalComponentInfo.get(id)?.serde
}

/** @internal */
export function isGlobalComponentTag(id: number): boolean {
  return globalComponentInfo.get(id)?.isTag ?? false
}

/** @internal — called by defineRelation */
export function registerGlobalComponent(
  id: number,
  serde: ComponentSerde<unknown> | undefined,
  isTag: boolean,
): void {
  if (!globalComponentInfo.has(id)) {
    globalComponentInfo.set(id, {serde, isTag})
  }
}

export type ComponentInstance<T> = {
  readonly component: ComponentLike
  readonly value: T
}

export type ComponentLike = {
  readonly __component_brand: true
  readonly name: string
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
  name: string,
  serde?: ComponentSerde<T>,
  id?: number,
): Component<T> {
  const component = ((value: T): ComponentInstance<T> => ({
    component: component as unknown as ComponentLike,
    value,
  })) as unknown as Record<string, unknown>

  Object.defineProperty(component, "name", {value: name, writable: false, configurable: true})
  if (id !== undefined) component.id = id
  component.serde = serde
  component.__component_brand = true

  // Register in global serde map (first-writer-wins so runtime
  // placeholders never overwrite real definitions from module scope).
  const componentId = id ?? hashNameToComponentId(name)
  if (!globalComponentInfo.has(componentId)) {
    globalComponentInfo.set(componentId, {
      serde: serde as ComponentSerde<unknown> | undefined,
      isTag: false,
    })
  }

  return component as unknown as Component<T>
}

export function defineTag(name: string, id?: number): Component<void> {
  const component = ((value: void): ComponentInstance<void> => ({
    component: component as unknown as ComponentLike,
    value,
  })) as unknown as Record<string, unknown>

  Object.defineProperty(component, "name", {value: name, writable: false, configurable: true})
  if (id !== undefined) component.id = id
  component.isTag = true
  component.__component_brand = true

  const componentId = id ?? hashNameToComponentId(name)
  if (!globalComponentInfo.has(componentId)) {
    globalComponentInfo.set(componentId, {serde: undefined, isTag: true})
  }

  return component as unknown as Component<void>
}
