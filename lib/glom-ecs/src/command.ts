import type {Component, ComponentInstance, ComponentLike} from "./component"
import {defineComponent, defineTag} from "./component"
import {Entity} from "./entity"
import {All} from "./query/all"
import {Has, World as WorldTerm} from "./query/term"
import {defineRelation} from "./relation"
import {defineSystem} from "./system"
import type {World} from "./world"
import {
  addComponent,
  addResource,
  despawn,
  getResource,
  removeComponent,
  spawn,
} from "./world_api"

export const CommandOf = defineRelation(2)
export const CommandEntity = defineTag(3)

export const CommandBuffer = defineComponent<Map<number, CommandInstance[]>>(
  {
    bytesPerElement: 0,
    encode: () => {},
    decode: () => new Map(),
  },
  11,
)

export const IntentTick = defineComponent<number>(
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
  if (!commandBuffer) {
    commandBuffer = new Map()
    addResource(world, CommandBuffer(commandBuffer))
  }

  let commandList = commandBuffer.get(tick)
  if (!commandList) {
    commandList = []
    commandBuffer.set(tick, commandList)
  }

  if (command && typeof command === "object" && "component" in command) {
    const inst = command as ComponentInstance<T>
    commandList.push({
      target,
      componentId: world.componentRegistry.getId(inst.component),
      data: inst.value,
      intentTick,
    })
  } else {
    const component = command as ComponentLike
    commandList.push({
      target,
      componentId: world.componentRegistry.getId(component),
      data: undefined,
      intentTick,
    })
  }
}

export const COMMAND_DOMAIN = 2047

export function pruneCommands(world: World, minTick: number) {
  const commandBuffer = getResource(world, CommandBuffer)
  if (!commandBuffer) return

  for (const tick of commandBuffer.keys()) {
    if (tick < minTick) {
      commandBuffer.delete(tick)
    }
  }
}

export const spawnEphemeralCommands = defineSystem(
  (world: World) => {
    const commandBuffer = getResource(world, CommandBuffer)
    if (!commandBuffer) return

    const commands = commandBuffer.get(world.tick)
    if (!commands) return

    for (const cmd of commands) {
      const comp = world.componentRegistry.getComponent(cmd.componentId)
      if (!comp) continue

      let commandEntity: Entity
      const baseComponents = [IntentTick(cmd.intentTick), CommandEntity]
      if (cmd.data !== undefined) {
        commandEntity = spawn(
          world,
          [
            {component: comp as Component<unknown>, value: cmd.data},
            ...baseComponents,
          ],
          COMMAND_DOMAIN,
        )
      } else {
        commandEntity = spawn(
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
      const incoming = world.relations.objectToSubjects.get(cmdEnt)
      if (incoming) {
        const commandOfId = world.componentRegistry.getId(CommandOf)
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
