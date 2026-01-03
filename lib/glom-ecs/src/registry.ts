import {
  type Component,
  type ComponentLike,
  type ComponentResolver,
  type ComponentSerde,
  define_tag,
} from "./component"

export class ComponentRegistry implements ComponentResolver {
  private components = new Map<number, ComponentLike>()
  private virtual_cache = new Map<number, Component<void>>()
  private next_virtual_id = 1000000

  constructor(schema: ComponentLike[] = []) {
    for (const comp of schema) {
      this.register(comp)
    }
  }

  register(comp: ComponentLike): void {
    this.components.set(comp.id, comp)
  }

  get_serde(id: number): ComponentSerde<unknown> | undefined {
    const comp = this.components.get(id) as Component<unknown> | undefined
    return comp?.serde
  }

  is_tag(id: number): boolean {
    if (id >= 1000000) return true
    const comp = this.components.get(id)
    return !!comp?.is_tag
  }

  get_component(id: number): ComponentLike | undefined {
    if (id >= 1000000) return this.get_virtual_component(id)
    return this.components.get(id)
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
}

export function make_component_registry(
  schema: ComponentLike[] = [],
): ComponentRegistry {
  return new ComponentRegistry(schema)
}

