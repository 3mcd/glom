import type {Component, ComponentInstance, ComponentLike} from "./component"
import {define_component, define_tag} from "./component"
import {Entity} from "./entity"
import {All} from "./query/all"
import {Has, World as WorldTerm} from "./query/term"
import {define_relation} from "./relation"
import {define_system} from "./system"
import type {World} from "./world"
import {add_component, despawn, remove_component, spawn} from "./world_api"

export const CommandOf = define_relation(2)
export const CommandEntity = define_tag(3)

export const IntentTick = define_component<number>(
  {
    bytes_per_element: 4,
    encode: (val, writer) => {
      writer.write_uint32(val)
    },
    decode: (reader) => {
      return reader.read_uint32()
    },
  },
  4,
)

export type CommandInstance = {
  target: Entity
  component_id: number
  data: unknown
  intent_tick: number
}

/**
 * Records a command for a specific tick targeting a specific entity.
 * Commands are ephemeral data attached to entities only for the duration of a tick.
 */
export function record_command<T>(
  world: World,
  target: Entity,
  command: ComponentInstance<T> | ComponentLike,
  tick = world.tick,
  intent_tick = tick,
) {
  let list = world.command_buffer.get(tick)
  if (!list) {
    list = []
    world.command_buffer.set(tick, list)
  }

  if (command && typeof command === "object" && "component" in command) {
    const inst = command as ComponentInstance<T>
    list.push({
      target,
      component_id: world.component_registry.get_id(inst.component),
      data: inst.value,
      intent_tick,
    })
  } else {
    const comp = command as ComponentLike
    list.push({
      target,
      component_id: world.component_registry.get_id(comp),
      data: undefined,
      intent_tick,
    })
  }
}

export const COMMAND_DOMAIN = 2047 // Reserved high domain for ephemeral command entities

/**
 * Prunes the command buffer, removing all commands older than the specified tick.
 */
export function prune_commands(world: World, min_tick: number) {
  for (const tick of world.command_buffer.keys()) {
    if (tick < min_tick) {
      world.command_buffer.delete(tick)
    }
  }
}

/**
 * System: Spawns ephemeral command entities for the current tick and links them to targets.
 */
export const spawn_ephemeral_commands = define_system(
  (world: World) => {
    const commands = world.command_buffer.get(world.tick)
    if (!commands) return

    for (const cmd of commands) {
      const comp = world.component_registry.get_component(cmd.component_id)
      if (!comp) continue

      let command_entity: Entity
      const base_components = [IntentTick(cmd.intent_tick), CommandEntity]
      if (cmd.data !== undefined) {
        command_entity = spawn(
          world,
          [
            {component: comp as Component<unknown>, value: cmd.data},
            ...base_components,
          ],
          COMMAND_DOMAIN,
        )
      } else {
        command_entity = spawn(
          world,
          [comp, ...base_components],
          COMMAND_DOMAIN,
        )
      }

      // Link to target
      add_component(world, cmd.target, CommandOf(command_entity))
    }
  },
  {params: [WorldTerm()], name: "spawn_ephemeral_commands"},
)

/**
 * System: Despawns all entities tagged with CommandEntity and removes CommandOf relations.
 */
export const cleanup_ephemeral_commands = define_system(
  (query: All<Entity, Has<typeof CommandEntity>>, world: World) => {
    for (const [cmd_ent] of query) {
      // Find who this command belongs to (incoming relations)
      const incoming = world.relations.object_to_subjects.get(cmd_ent)
      if (incoming) {
        const command_of_id = world.component_registry.get_id(CommandOf)
        for (const {subject, relation_id} of Array.from(incoming)) {
          if (relation_id === command_of_id) {
            remove_component(world, subject as Entity, CommandOf(cmd_ent))
          }
        }
      }
      despawn(world, cmd_ent)
    }
  },
  {
    params: [All(Entity, Has(CommandEntity)), WorldTerm()],
    name: "cleanup_ephemeral_commands",
  },
)
