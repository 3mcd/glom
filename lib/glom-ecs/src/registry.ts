import {
  type Component,
  type ComponentLike,
  type ComponentResolver,
  type ComponentSerde,
  defineTag,
} from "./component"

export interface RegistrySchema {
  network?: ComponentLike[]
  local?: ComponentLike[]
}

export class ComponentRegistry implements ComponentResolver {
  private compToId = new Map<ComponentLike, number>()
  private idToComp = new Map<number, ComponentLike>()
  private virtualCache = new Map<number, Component<void>>()
  private nextVirtualId = 1000000

  constructor(schema: RegistrySchema = {}, fixed: ComponentLike[] = []) {
    for (const comp of fixed) {
      if (comp.id === undefined) {
        throw new Error("Core components must have a fixed ID")
      }
      this.register(comp, comp.id)
    }

    if (schema.network) {
      for (let i = 0; i < schema.network.length; i++) {
        this.register(schema.network[i]!, 100 + i)
      }
    }

    if (schema.local) {
      for (let i = 0; i < schema.local.length; i++) {
        this.register(schema.local[i]!, 10000 + i)
      }
    }
  }

  private register(comp: ComponentLike, id: number): void {
    this.compToId.set(comp, id)
    this.idToComp.set(id, comp)
  }

  getId(comp: ComponentLike | {component: ComponentLike}): number {
    const target = "component" in comp ? comp.component : comp
    const id = this.compToId.get(target)
    if (id !== undefined) return id

    const targetObj = target as Record<string, unknown>
    if (typeof targetObj.id === "number") {
      const id = targetObj.id
      if (id >= 1000000) return id

      if (this.idToComp.has(id)) return id
    }

    console.error("Unregistered component:", target)
    console.error(
      "Available components in registry:",
      Array.from(this.compToId.keys()),
    )
    throw new Error("Component not registered in this world's schema")
  }

  getSerde(id: number): ComponentSerde<unknown> | undefined {
    const comp = this.idToComp.get(id) as Component<unknown> | undefined
    return comp?.serde
  }

  isTag(id: number): boolean {
    if (id >= 1000000) return true
    const comp = this.idToComp.get(id)
    return !!comp?.isTag
  }

  getComponent(id: number): ComponentLike | undefined {
    if (id >= 1000000) return this.getVirtualComponent(id)
    return this.idToComp.get(id)
  }

  getVirtualComponent(id: number): Component<void> {
    let comp = this.virtualCache.get(id)
    if (!comp) {
      comp = defineTag(id)
      this.virtualCache.set(id, comp)
    }
    return comp
  }

  allocVirtualId(): number {
    return this.nextVirtualId++
  }

  getNextVirtualId(): number {
    return this.nextVirtualId
  }

  setNextVirtualId(id: number): void {
    this.nextVirtualId = id
  }
}

export function makeComponentRegistry(
  schema: RegistrySchema = {},
  fixed: ComponentLike[] = [],
): ComponentRegistry {
  return new ComponentRegistry(schema, fixed)
}
