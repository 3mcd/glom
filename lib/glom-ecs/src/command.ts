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

export const CommandOf = defineRelation("glom/CommandOf")
export const CommandEntity = defineTag("glom/CommandEntity")

export const CommandBuffer = defineComponent<Map<number, CommandInstance[]>>(
  "glom/CommandBuffer",
  {
    bytesPerElement: 0,
    encode: () => {},
    decode: () => new Map(),
  },
)

export const IntentTick = defineComponent<number>("glom/IntentTick", {
  bytesPerElement: 4,
  encode: (val, writer) => {
    writer.writeUint32(val)
  },
  decode: (reader) => {
    return reader.readUint32()
  },
})

export type Command = {
  target: Entity
  componentId: number
  data: unknown
}

export type CommandInstance = Command & {
  tick: number
}

export function recordCommand<T>(
  world: World,
  target: Entity,
  command:
    | ComponentInstance<T>
    | ComponentLike
    | {componentId: number; data?: unknown},
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

  if (command && typeof command === "object" && "componentId" in command) {
    // Raw wire format from readCommands — already has componentId + data
    const raw = command as {componentId: number; data?: unknown}
    commandList.push({
      target,
      componentId: raw.componentId,
      data: raw.data,
      tick: intentTick,
    })
  } else if (command && typeof command === "object" && "component" in command) {
    const inst = command as ComponentInstance<T>
    commandList.push({
      target,
      componentId: getComponentId(world, inst.component),
      data: inst.value,
      tick: intentTick,
    })
  } else {
    const component = command as ComponentLike
    commandList.push({
      target,
      componentId: getComponentId(world, component),
      data: undefined,
      tick: intentTick,
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
    if (commandBuffer === undefined) {
      return
    }
    const commands = commandBuffer.get(world.tick)
    if (commands === undefined) {
      return
    }
    for (const command of commands) {
      const component = resolveComponent(world, command.componentId)
      if (component === undefined) {
        continue
      }
      let commandEntity: Entity
      const baseComponents = [IntentTick(command.tick), CommandEntity]
      if (command.data !== undefined) {
        commandEntity = spawnInDomain(
          world,
          [
            {component: component as Component<unknown>, value: command.data},
            ...baseComponents,
          ],
          COMMAND_DOMAIN,
        )
      } else {
        commandEntity = spawnInDomain(
          world,
          [component, ...baseComponents],
          COMMAND_DOMAIN,
        )
      }
      addComponent(world, command.target, CommandOf(commandEntity))
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
