import type {Component, ComponentInstance, ComponentLike} from "./component"
import {defineComponent, defineTag} from "./component"
import {Entity} from "./entity"
import {All} from "./query/all"
import {Has, World as WorldTerm} from "./query/term"
import {defineRelation} from "./relation"
import {getObjectSubjects} from "./relation_registry"
import {COMMAND_DOMAIN} from "./replication"
import {defineSystem} from "./system"
import {getComponentId, resolveComponent, type World} from "./world"
import {
  addComponent,
  addResource,
  despawn,
  getResource,
  removeComponent,
  spawnInDomain,
} from "./world_api"

export const CommandOf = defineRelation("glom/CommandOf", 2)
export const CommandEntity = defineTag("glom/CommandEntity", 3)

export const CommandBuffer = defineComponent<Map<number, CommandInstance[]>>(
  "glom/CommandBuffer",
  {
    bytesPerElement: 0,
    encode: () => {},
    decode: () => new Map(),
  },
  11,
)

export const IntentTick = defineComponent<number>(
  "glom/IntentTick",
  {
    bytesPerElement: 4,
    encode: (val, writer) => {
      writer.writeUint32(val)
    },
    decode: (reader) => {
      return reader.readUint32()
    },
  },
  4,
)

export type CommandInstance = {
  target: Entity
  componentId: number
  data: unknown
  intentTick: number
}

export function recordCommand<T>(
  world: World,
  target: Entity,
  command: ComponentInstance<T> | ComponentLike,
  tick = world.tick,
  intentTick = tick,
) {
  let commandBuffer = getResource(world, CommandBuffer)
  if (commandBuffer === undefined) {
    commandBuffer = new Map()
    addResource(world, CommandBuffer(commandBuffer))
  }

  let commandList = commandBuffer.get(tick)
  if (commandList === undefined) {
    commandList = []
    commandBuffer.set(tick, commandList)
  }

  if (command && typeof command === "object" && "component" in command) {
    const inst = command as ComponentInstance<T>
    commandList.push({
      target,
      componentId: getComponentId(world, inst.component),
      data: inst.value,
      intentTick,
    })
  } else {
    const component = command as ComponentLike
    commandList.push({
      target,
      componentId: getComponentId(world, component),
      data: undefined,
      intentTick,
    })
  }
}

export function pruneCommands(world: World, minTick: number) {
  const commandBuffer = getResource(world, CommandBuffer)
  if (commandBuffer === undefined) return

  for (const tick of commandBuffer.keys()) {
    if (tick < minTick) {
      commandBuffer.delete(tick)
    }
  }
}

export const spawnEphemeralCommands = defineSystem(
  (world: World) => {
    const commandBuffer = getResource(world, CommandBuffer)
    if (commandBuffer === undefined) return

    const commands = commandBuffer.get(world.tick)
    if (commands === undefined) return

    for (const cmd of commands) {
      const comp = resolveComponent(world, cmd.componentId)
      if (comp === undefined) continue

      let commandEntity: Entity
      const baseComponents = [IntentTick(cmd.intentTick), CommandEntity]
      if (cmd.data !== undefined) {
        commandEntity = spawnInDomain(
          world,
          [
            {component: comp as Component<unknown>, value: cmd.data},
            ...baseComponents,
          ],
          COMMAND_DOMAIN,
        )
      } else {
        commandEntity = spawnInDomain(
          world,
          [comp, ...baseComponents],
          COMMAND_DOMAIN,
        )
      }

      addComponent(world, cmd.target, CommandOf(commandEntity))
    }
  },
  {params: [WorldTerm()], name: "spawnEphemeralCommands"},
)

export const cleanupEphemeralCommands = defineSystem(
  (query: All<Entity, Has<typeof CommandEntity>>, world: World) => {
    for (const [cmdEnt] of query) {
      const incoming = getObjectSubjects(world, cmdEnt)
      if (incoming !== undefined) {
        const commandOfId = getComponentId(world, CommandOf)
        for (const {subject, relationId} of Array.from(incoming)) {
          if (relationId === commandOfId) {
            removeComponent(world, subject as Entity, CommandOf(cmdEnt))
          }
        }
      }
      despawn(world, cmdEnt)
    }
  },
  {
    params: [All(Entity, Has(CommandEntity)), WorldTerm()],
    name: "cleanupEphemeralCommands",
  },
)
