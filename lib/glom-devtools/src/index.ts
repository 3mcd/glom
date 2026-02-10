import type {ComponentLike, Entity, EntityGraphNode, World} from "@glom/ecs"
import {
  entityGraphGetEntityNode,
  getComponentValue,
  sparseSetValues,
} from "@glom/ecs"
import htm from "htm"
import type {VNode} from "preact"
import {h, render} from "preact"

const html = htm.bind(h)

export type DevtoolsOptions = {
  /** Maximum number of command log entries to keep (default 200). */
  maxCommandLogEntries?: number
  /** DOM element to mount the panel into (default: document.body). */
  container?: HTMLElement
  /** Start with the panel open (default true). */
  open?: boolean
}

export type CommandLogEntry = {
  tick: number
  targetEntity: number
  componentId: number
  componentName: string
  data: unknown
  timestamp: number
}

export type Devtools = {
  /** Call once per tick (or per frame) to refresh the panel. */
  update(): void
  /** Remove the panel and clean up all DOM. */
  destroy(): void
  /** Toggle panel visibility. */
  toggle(): void
}

type PanelState = {
  isOpen: boolean
  activeTab: "entities" | "commands"
  selectedEntity: Entity | null
}

function componentIdToName(world: World, componentId: number): string {
  const comp = world.componentRegistry.getComponent(componentId)
  if (comp?.name) return comp.name
  if (componentId >= 1000000) return `Virtual(${componentId})`
  return `Component(${componentId})`
}

function componentRefToName(world: World, comp: ComponentLike): string {
  if (comp.name) return comp.name
  const id = world.componentRegistry.getId(comp)
  if (id >= 1000000) return `Virtual(${id})`
  return `Component(${id})`
}

type EntityInfo = {
  entity: Entity
  components: {comp: ComponentLike; id: number; name: string}[]
}

function collectEntities(world: World): EntityInfo[] {
  const entities: EntityInfo[] = []
  world.entityGraph.byHash.forEach((node: EntityGraphNode) => {
    const ents = sparseSetValues(node.entities)
    for (let i = 0; i < ents.length; i++) {
      const entity = ents[i]!
      const components: EntityInfo["components"] = []
      for (let j = 0; j < node.vec.elements.length; j++) {
        const comp = node.vec.elements[j] as ComponentLike
        components.push({
          comp,
          id: world.componentRegistry.getId(comp),
          name: componentRefToName(world, comp),
        })
      }
      entities.push({entity, components})
    }
  })
  entities.sort((a, b) => (a.entity as number) - (b.entity as number))
  return entities
}

function sniffCommands(
  world: World,
  log: CommandLogEntry[],
  seenTicks: Set<number>,
  maxEntries: number,
): boolean {
  const cbComp = world.componentRegistry.getComponent(11) // CommandBuffer id=11
  if (!cbComp) return false
  const RESOURCE_ENTITY = 2147483647
  const cbValue = getComponentValue<Map<number, unknown[]>>(
    world,
    RESOURCE_ENTITY,
    cbComp,
  )
  if (!cbValue || !(cbValue instanceof Map)) return false

  let added = false
  for (const [tick, commands] of cbValue) {
    if (seenTicks.has(tick)) continue
    seenTicks.add(tick)
    if (!Array.isArray(commands)) continue
    for (const cmd of commands) {
      if (
        cmd &&
        typeof cmd === "object" &&
        "target" in cmd &&
        "componentId" in cmd
      ) {
        const c = cmd as {
          target: number
          componentId: number
          data: unknown
          intentTick: number
        }
        log.push({
          tick,
          targetEntity: c.target,
          componentId: c.componentId,
          componentName: componentIdToName(world, c.componentId),
          data: c.data,
          timestamp: Date.now(),
        })
        added = true
      }
    }
  }
  while (log.length > maxEntries) log.shift()
  return added
}

function formatValue(value: unknown, depth = 0): VNode | string {
  if (depth > 4) return "…"
  if (value === undefined)
    return html`<span class="v-kw">undefined</span>` as VNode
  if (value === null) return html`<span class="v-kw">null</span>` as VNode
  if (typeof value === "number") {
    const s = Number.isInteger(value) ? String(value) : value.toFixed(3)
    return html`<span class="v-num">${s}</span>` as VNode
  }
  if (typeof value === "boolean")
    return html`<span class="v-kw">${String(value)}</span>` as VNode
  if (typeof value === "string")
    return html`<span class="v-str">${JSON.stringify(value)}</span>` as VNode
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]"
    const items: (VNode | string)[] = ["["]
    const limit = Math.min(value.length, 8)
    for (let i = 0; i < limit; i++) {
      if (i > 0) items.push(", ")
      items.push(formatValue(value[i], depth + 1))
    }
    if (value.length > 8) items.push(", …")
    items.push("]")
    return html`<span>${items}</span>` as VNode
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return "{}"
    const limit = Math.min(entries.length, 8)
    const items: (VNode | string)[] = []
    for (let i = 0; i < limit; i++) {
      const [k, v] = entries[i]!
      if (i > 0) items.push("\n")
      items.push(html`<span class="v-key">${k}</span>` as VNode)
      items.push(": ")
      items.push(formatValue(v, depth + 1))
    }
    if (entries.length > 8) items.push("\n…")
    return html`<span>${items}</span>` as VNode
  }
  return String(value)
}

function formatValuePlain(value: unknown, depth = 0): string {
  if (depth > 3) return "…"
  if (value === undefined) return "undefined"
  if (value === null) return "null"
  if (typeof value === "number")
    return Number.isInteger(value) ? String(value) : value.toFixed(3)
  if (typeof value === "boolean") return String(value)
  if (typeof value === "string") return JSON.stringify(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]"
    const items = value
      .slice(0, 8)
      .map((v) => formatValuePlain(v, depth + 1))
      .join(", ")
    return value.length > 8 ? `[${items}, …]` : `[${items}]`
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return "{}"
    const items = entries
      .slice(0, 8)
      .map(([k, v]) => `${k}: ${formatValuePlain(v, depth + 1)}`)
      .join(", ")
    return entries.length > 8 ? `{${items}, …}` : `{${items}}`
  }
  return String(value)
}

const CSS = `
.gd{
  --gd-bg:#0f0f0f;--gd-text:#d6d6d6;--gd-border:#585858;
  --gd-code:#222;--gd-blue:#7ec7f8;--gd-yellow:#dfdd8a;--gd-pink:#f089e5;
  --gd-red:#ff8b78;--gd-green:#bedd9f;--gd-muted:#666;
  position:fixed;top:0;right:0;width:22rem;max-height:100vh;
  background:var(--gd-bg);color:var(--gd-text);
  font:0.75rem/1.1rem "Aporetic Sans Mono",SFMono-Regular,Consolas,monospace;
  z-index:999999;display:flex;flex-direction:column;overflow:hidden;
  border-left:1px solid var(--gd-border);border-bottom:1px solid var(--gd-border)
}
@media(prefers-color-scheme:light){.gd{
  --gd-bg:#fefefe;--gd-text:#1a1a1a;--gd-border:#ddd;--gd-header:#f5f5f5;
  --gd-code:#f0f0f0;--gd-blue:#005a9e;--gd-yellow:#6d6d00;--gd-pink:#a0008a;
  --gd-red:#b00000;--gd-green:#2d5a27;--gd-muted:#707070
}}
.gd.off{width:auto;max-height:none}
.gd-sb{
  display:flex;align-items:center;justify-content:space-between;
  padding:0.5rem 1rem;cursor:pointer;
  user-select:none;border-top:1px solid var(--gd-border);flex-shrink:0;
  color:var(--gd-muted)
}
.gd-b{overflow-y:auto;flex:1;min-height:0}
.gd-tabs{display:flex;border-bottom:1px solid var(--gd-border);flex-shrink:0}
.gd-tab{
  flex:1;padding:0.5rem 1rem;text-align:left;cursor:pointer;
  color:var(--gd-muted);background:0 0;border:none;font:inherit;
  border-bottom:1px solid transparent;transition:color .1s
}
.gd-tab:hover{color:var(--gd-text);background:var(--gd-header)}
.gd-tab.on{color:var(--gd-blue);border-bottom-color:var(--gd-blue)}
.gd-ct{padding:0}
.gd-er{
  display:flex;align-items:baseline;padding:0.5rem 1rem;cursor:pointer;
  transition:background .1s;gap:1rem
}
.gd-er:hover{background:var(--gd-header)}
.gd-eid{color:var(--gd-red);font-weight:bold;flex-shrink:0}
.gd-et{display:flex;flex-wrap:wrap;gap:0.5rem;overflow:hidden}
.gd-ct-tag{color:var(--gd-yellow);white-space:nowrap}
.gd-ct-tag.t{color:var(--gd-blue)}
.gd-ins{padding:1rem}
.gd-ins-t{
  color:var(--gd-red);font-weight:bold;margin-bottom:1rem;
  display:flex;align-items:center;gap:1rem;
  padding-bottom:0.5rem;border-bottom:1px dashed var(--gd-border)
}
.gd-bk{color:var(--gd-muted);cursor:pointer}
.gd-bk:hover{color:var(--gd-text)}
.gd-cs{margin-bottom:1rem;border:1px solid var(--gd-border);overflow:hidden}
.gd-ch{
  background:var(--gd-header);padding:0.5rem 1rem;
  font-weight:bold;color:var(--gd-yellow);
  border-bottom:1px solid var(--gd-border)
}
.gd-cv{
  padding:0.5rem 1rem;color:var(--gd-text);
  word-break:break-all;white-space:pre-wrap;line-height:1.4rem
}
.gd-cv .v-key{color:var(--gd-blue)}
.gd-cv .v-num{color:var(--gd-pink)}
.gd-cv .v-str{color:var(--gd-green)}
.gd-cv .v-kw{color:var(--gd-red)}
.gd-tg{color:var(--gd-muted);font-style:italic;padding:0.5rem 1rem}
.gd-cr{
  padding:0.5rem 1rem;
  line-height:1.4rem
}
.gd-cr .ct{color:var(--gd-muted);margin-right:1rem}
.gd-cr .ce{color:var(--gd-red)}
.gd-cr .cn{color:var(--gd-yellow);font-weight:bold}
.gd-cr .cd{color:var(--gd-muted);margin-left:0.5rem}
.gd-em{color:var(--gd-muted);text-align:center;padding:2rem 1rem;font-style:italic}
.gd-cnt{
  color:var(--gd-muted);padding:0.5rem 1rem;
  border-bottom:1px solid var(--gd-border)
}
`

function EntityRow({
  entity,
  components,
  onSelect,
}: {
  entity: Entity
  components: EntityInfo["components"]
  onSelect: (e: Entity) => void
}) {
  return html`
    <div class="gd-er" onClick=${() => onSelect(entity)}>
      <span class="gd-eid">e${String(entity)}</span>
      <div class="gd-et">
        ${components.map(
          (c) =>
            html`<span key=${c.id} class=${c.comp.isTag ? "gd-ct-tag t" : "gd-ct-tag"}>${c.name}</span>`,
        )}
      </div>
    </div>
  `
}

function EntityListView({
  world,
  onSelect,
}: {
  world: World
  onSelect: (e: Entity) => void
}) {
  const entities = collectEntities(world)
  return html`
    <div>
      <div class="gd-cnt">${entities.length} entities</div>
      ${
        entities.length === 0
          ? html`<div class="gd-em">No entities</div>`
          : entities.map(
              (info) =>
                html`<${EntityRow}
                  key=${info.entity as number}
                  entity=${info.entity}
                  components=${info.components}
                  onSelect=${onSelect}
                />`,
            )
      }
    </div>
  `
}

function ComponentValueView({
  world,
  entity,
  comp,
}: {
  world: World
  entity: Entity
  comp: ComponentLike
}) {
  const value = getComponentValue(world, entity as number, comp)
  return html`<div class="gd-cv">${formatValue(value)}</div>`
}

function InspectorView({
  world,
  entity,
  onBack,
}: {
  world: World
  entity: Entity
  onBack: () => void
}) {
  const node = entityGraphGetEntityNode(world.entityGraph, entity)
  if (!node) return html`<div class="gd-em">Entity not found</div>`

  return html`
    <div class="gd-ins">
      <div class="gd-ins-t">
        <span class="gd-bk" onClick=${onBack}>←</span>
        ${`Entity e${entity}`}
      </div>
      ${node.vec.elements.map((el) => {
        const comp = el as ComponentLike
        const name = componentRefToName(world, comp)
        const id = world.componentRegistry.getId(comp)
        return html`
          <div class="gd-cs" key=${id}>
            <div class="gd-ch">${name}</div>
            ${!comp.isTag && html`<${ComponentValueView} world=${world} entity=${entity} comp=${comp} />`}
          </div>
        `
      })}
    </div>
  `
}

function CommandLogView({commandLog}: {commandLog: CommandLogEntry[]}) {
  if (commandLog.length === 0)
    return html`<div class="gd-em">No commands recorded yet</div>`

  const rows = []
  for (let i = commandLog.length - 1; i >= 0; i--) {
    const entry = commandLog[i]!
    rows.push(html`
      <div class="gd-cr" key=${i}>
        <span class="ct">t${entry.tick}</span>
        <span class="ce">e${entry.targetEntity}</span>${" "}
        <span class="cn">${entry.componentName}</span>
        ${entry.data !== undefined && html`<span class="cd">${formatValuePlain(entry.data)}</span>`}
      </div>
    `)
  }

  return html`
    <div>
      <div class="gd-cnt">${commandLog.length} commands</div>
      ${rows}
    </div>
  `
}

function App({
  world,
  commandLog,
  state,
  setState,
}: {
  world: World
  commandLog: CommandLogEntry[]
  state: PanelState
  setState: (partial: Partial<PanelState>) => void
}) {
  const {isOpen, activeTab, selectedEntity} = state

  return html`
    <div class=${isOpen ? "gd" : "gd off"}>
      ${
        isOpen &&
        html`
        <div class="gd-b">
          <div class="gd-tabs">
            <button
              class=${activeTab === "entities" ? "gd-tab on" : "gd-tab"}
              onClick=${() => setState({activeTab: "entities"})}
            >
              Entities
            </button>
            <button
              class=${activeTab === "commands" ? "gd-tab on" : "gd-tab"}
              onClick=${() => setState({activeTab: "commands"})}
            >
              Commands
            </button>
          </div>
          <div class="gd-ct">
            ${
              activeTab === "entities"
                ? selectedEntity !== null
                  ? html`<${InspectorView}
                      world=${world}
                      entity=${selectedEntity}
                      onBack=${() => setState({selectedEntity: null})}
                    />`
                  : html`<${EntityListView}
                      world=${world}
                      onSelect=${(e: Entity) => setState({selectedEntity: e})}
                    />`
                : html`<${CommandLogView} commandLog=${commandLog} />`
            }
          </div>
        </div>
      `
      }
      <div class="gd-sb" onClick=${() => setState({isOpen: !isOpen})}>
        <span>tick ${world.tick}</span>
      </div>
    </div>
  `
}

export function createDevtools(
  world: World,
  options: DevtoolsOptions = {},
): Devtools {
  const {
    maxCommandLogEntries = 200,
    container = document.body,
    open: startOpen = true,
  } = options

  const commandLog: CommandLogEntry[] = []
  const seenCommandTicks = new Set<number>()

  const state: PanelState = {
    isOpen: startOpen,
    activeTab: "entities",
    selectedEntity: null,
  }

  // --- Inject styles -------------------------------------------------------
  const style = document.createElement("style")
  style.textContent = CSS
  document.head.appendChild(style)

  // --- Mount point ---------------------------------------------------------
  const wrapper = document.createElement("div")
  container.appendChild(wrapper)

  function doRender() {
    // Auto-deselect if entity no longer exists
    if (state.selectedEntity !== null) {
      const node = entityGraphGetEntityNode(
        world.entityGraph,
        state.selectedEntity,
      )
      if (!node) state.selectedEntity = null
    }

    render(
      html`<${App}
        world=${world}
        commandLog=${commandLog}
        state=${state}
        setState=${(partial: Partial<PanelState>) => {
          Object.assign(state, partial)
          doRender()
        }}
      />`,
      wrapper,
    )
  }

  doRender()

  return {
    update() {
      sniffCommands(world, commandLog, seenCommandTicks, maxCommandLogEntries)
      doRender()
    },
    destroy() {
      render(null, wrapper)
      wrapper.remove()
      style.remove()
    },
    toggle() {
      state.isOpen = !state.isOpen
      doRender()
    },
  }
}
