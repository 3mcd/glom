import {
  type Component,
  type ComponentLike,
  type ComponentResolver,
  type ComponentSerde,
  defineComponent,
  defineTag,
  getGlobalComponentSerde,
  isGlobalComponentTag,
} from "./component"
import {hashNameToComponentId} from "./lib/hash"

/**
 * Marker on placeholder components created when receiving remote data
 * before the real component has been locally registered.
 */
const PLACEHOLDER = Symbol("placeholder")

export class ComponentRegistry implements ComponentResolver {
  private compToId = new Map<ComponentLike, number>()
  private idToComp = new Map<number, ComponentLike>()
  private virtualCache = new Map<number, Component<void>>()
  private nextVirtualId = 1000000

  constructor(fixed: ComponentLike[] = []) {
    for (const comp of fixed) {
      if (comp.id === undefined) {
        throw new Error("Core components must have a fixed ID")
      }
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
    if (target.name) {
      const id = hashNameToComponentId(target.name)
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

    // Fallback for raw numeric IDs (e.g. from protocol or inline stubs)
    const targetObj = target as Record<string, unknown>
    if (typeof targetObj.id === "number") {
      if (targetObj.id >= 1_000_000) return targetObj.id
      if (this.idToComp.has(targetObj.id)) return targetObj.id
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
    if (comp?.serde !== undefined) return comp.serde
    // Fall back to global map populated at defineComponent time
    return getGlobalComponentSerde(id)
  }

  isTag(id: number): boolean {
    if (id >= 1000000) return true
    const comp = this.idToComp.get(id)
    if (comp !== undefined) return !!comp.isTag
    // Fall back to global map populated at defineComponent/defineTag time
    return isGlobalComponentTag(id)
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
    // Create a lightweight component that serves as a stand-in until the
    // real component is registered.
    const placeholder = defineComponent<unknown>(
      `__placeholder_${id}`,
      undefined,
      id,
    )
    ;(placeholder as any)[PLACEHOLDER] = true
    // Register in both maps so getId(placeholder) returns the correct ID.
    // When the real component is later registered via getId(), the PLACEHOLDER
    // flag allows it to overwrite this entry.
    this.register(placeholder, id)
    return placeholder
  }

  getVirtualComponent(id: number): Component<void> {
    let comp = this.virtualCache.get(id)
    if (comp === undefined) {
      comp = defineTag(`__virtual_${id}`, id)
      this.virtualCache.set(id, comp)
      // Register in compToId so getId() returns the virtual ID directly
      // instead of falling through to name-hashing.
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
  fixed: ComponentLike[] = [],
): ComponentRegistry {
  return new ComponentRegistry(fixed)
}
