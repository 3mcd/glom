import {
  type Component,
  type ComponentLike,
  type ComponentResolver,
  type ComponentSerde,
  define_tag,
} from "./component"

export interface RegistrySchema {
  network?: ComponentLike[]
  local?: ComponentLike[]
}

export class ComponentRegistry implements ComponentResolver {
  private comp_to_id = new Map<ComponentLike, number>()
  private id_to_comp = new Map<number, ComponentLike>()
  private virtual_cache = new Map<number, Component<void>>()
  private next_virtual_id = 1000000

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
    this.comp_to_id.set(comp, id)
    this.id_to_comp.set(id, comp)
  }

  get_id(comp: ComponentLike | {component: ComponentLike}): number {
    const target = "component" in comp ? comp.component : comp
    const id = this.comp_to_id.get(target)
    if (id !== undefined) return id

    const target_obj = target as Record<string, unknown>
    if (typeof target_obj.id === "number") {
      const id = target_obj.id
      if (id >= 1000000) return id

      if (this.id_to_comp.has(id)) return id
    }

    console.error("Unregistered component:", target)
    console.error(
      "Available components in registry:",
      Array.from(this.comp_to_id.keys()),
    )
    throw new Error("Component not registered in this world's schema")
  }

  get_serde(id: number): ComponentSerde<unknown> | undefined {
    const comp = this.id_to_comp.get(id) as Component<unknown> | undefined
    return comp?.serde
  }

  is_tag(id: number): boolean {
    if (id >= 1000000) return true
    const comp = this.id_to_comp.get(id)
    return !!comp?.is_tag
  }

  get_component(id: number): ComponentLike | undefined {
    if (id >= 1000000) return this.get_virtual_component(id)
    return this.id_to_comp.get(id)
  }

  get_virtual_component(id: number): Component<void> {
    let comp = this.virtual_cache.get(id)
    if (!comp) {
      comp = define_tag(id)
      this.virtual_cache.set(id, comp)
    }
    return comp
  }

  alloc_virtual_id(): number {
    return this.next_virtual_id++
  }

  get_next_virtual_id(): number {
    return this.next_virtual_id
  }

  set_next_virtual_id(id: number): void {
    this.next_virtual_id = id
  }
}

export function make_component_registry(
  schema: RegistrySchema = {},
  fixed: ComponentLike[] = [],
): ComponentRegistry {
  return new ComponentRegistry(schema, fixed)
}
