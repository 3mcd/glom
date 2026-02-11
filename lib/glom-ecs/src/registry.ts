import * as Component from "./component"
import type {ComponentLike, ComponentResolver, ComponentSerde} from "./component"
import {hashNameToComponentId} from "./lib/hash"

/**
 * Marker on placeholder components created when receiving remote data
 * before the real component has been locally registered.
 */
const PLACEHOLDER = Symbol("placeholder")

export class ComponentRegistry implements ComponentResolver {
  private compToId = new Map<ComponentLike, number>()
  private idToComp = new Map<number, ComponentLike>()
  private virtualCache = new Map<number, Component.Component<void>>()
  private nextVirtualId = 1000000

  constructor(components: ComponentLike[] = []) {
    for (const comp of components) {
      this.register(comp, comp.id)
    }
  }

  private register(comp: ComponentLike, id: number): void {
    this.compToId.set(comp, id)
    this.idToComp.set(id, comp)
  }

  getId(comp: ComponentLike | {component: ComponentLike}): number {
    const target = "component" in comp ? comp.component : comp
    const existing = this.compToId.get(target)
    if (existing !== undefined) return existing

    // Auto-register by name hash
    const id = target.id
    const conflict = this.idToComp.get(id)
    if (conflict !== undefined && conflict !== target) {
      // Allow overwriting placeholders created by remote data
      if (!((conflict as any)[PLACEHOLDER] === true)) {
        throw new Error(
          `Component ID conflict: "${target.name}" and "${(conflict as ComponentLike).name}" both hash to ${id}`,
        )
      }
    }
    this.register(target, id)
    return id
  }

  getSerde(id: number): ComponentSerde<unknown> | undefined {
    const comp = this.idToComp.get(id) as Component.Component<unknown> | undefined
    if (comp?.serde !== undefined) return comp.serde
    // Fall back to global map populated at Component.define time
    return Component.getGlobalComponentSerde(id)
  }

  isTag(id: number): boolean {
    if (id >= 1000000) return true
    const comp = this.idToComp.get(id)
    if (comp !== undefined) return !!comp.isTag
    // Fall back to global map populated at Component.define/defineTag time
    return Component.isGlobalComponentTag(id)
  }

  getComponent(id: number): ComponentLike | undefined {
    if (id >= 1000000) return this.getVirtualComponent(id)
    const comp = this.idToComp.get(id)
    if (comp !== undefined) return comp
    // For hash-range IDs (100-999999), create a placeholder so remote
    // transactions can be applied before the real component is locally
    // registered.  When the real component is later registered via getId(),
    // it overwrites this placeholder.
    if (id >= 100 && id < 1000000) {
      return this.getOrCreatePlaceholder(id)
    }
    return undefined
  }

  private getOrCreatePlaceholder(id: number): ComponentLike {
    // Check the global map (populated at module load time) to decide
    // whether this component is a tag or carries data.
    const isTag = Component.isGlobalComponentTag(id)
    const placeholder = isTag
      ? Component.defineTag(`__placeholder_${id}`)
      : Component.define<unknown>(`__placeholder_${id}`)
    // Override the hash-derived id with the wire id so the registry
    // maps this placeholder to the correct slot.
    ;(placeholder as unknown as Record<string, unknown>).id = id
    ;(placeholder as any)[PLACEHOLDER] = true
    this.register(placeholder, id)
    return placeholder
  }

  getVirtualComponent(id: number): Component.Component<void> {
    let comp = this.virtualCache.get(id)
    if (comp === undefined) {
      comp = Component.defineTag(`__virtual_${id}`)
      // Override the hash-derived id with the virtual id.
      ;(comp as unknown as Record<string, unknown>).id = id
      this.virtualCache.set(id, comp)
      this.compToId.set(comp as unknown as ComponentLike, id)
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
  components: ComponentLike[] = [],
): ComponentRegistry {
  return new ComponentRegistry(components)
}
