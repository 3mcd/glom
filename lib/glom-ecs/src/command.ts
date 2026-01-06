import type {Component, ComponentInstance, ComponentLike} from "./component"
import {define_component, define_tag} from "./component"
import {Entity} from "./entity"
import {All} from "./query/all"
import {Has, World as WorldTerm} from "./query/term"
import {define_relation} from "./relation"
import {define_system} from "./system"
import type {World} from "./world"
import {
  add_component,
  add_resource,
  despawn,
  get_resource,
  remove_component,
  spawn,
} from "./world_api"

export const CommandOf = define_relation(2)
export const CommandEntity = define_tag(3)

export const CommandBuffer = define_component<Map<number, CommandInstance[]>>(
  {
    bytes_per_element: 0,
    encode: () => {},
    decode: () => new Map(),
  },
  11,
)

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

export function record_command<T>(
  world: World,
  target: Entity,
  command: ComponentInstance<T> | ComponentLike,
  tick = world.tick,
  intent_tick = tick,
) {
  let command_buffer = get_resource(world, CommandBuffer)
  if (!command_buffer) {
    command_buffer = new Map()
    add_resource(world, CommandBuffer(command_buffer))
  }

  let command_list = command_buffer.get(tick)
  if (!command_list) {
    command_list = []
    command_buffer.set(tick, command_list)
  }

  if (command && typeof command === "object" && "component" in command) {
    const inst = command as ComponentInstance<T>
    command_list.push({
      target,
      component_id: world.component_registry.get_id(inst.component),
      data: inst.value,
      intent_tick,
    })
  } else {
    const component = command as ComponentLike
    command_list.push({
      target,
      component_id: world.component_registry.get_id(component),
      data: undefined,
      intent_tick,
    })
  }
}

export const COMMAND_DOMAIN = 2047

export function prune_commands(world: World, min_tick: number) {
  const command_buffer = get_resource(world, CommandBuffer)
  if (!command_buffer) return

  for (const tick of command_buffer.keys()) {
    if (tick < min_tick) {
      command_buffer.delete(tick)
    }
  }
}

export const spawn_ephemeral_commands = define_system(
  (world: World) => {
    const command_buffer = get_resource(world, CommandBuffer)
    if (!command_buffer) return

    const commands = command_buffer.get(world.tick)
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

      add_component(world, cmd.target, CommandOf(command_entity))
    }
  },
  {params: [WorldTerm()], name: "spawn_ephemeral_commands"},
)

export const cleanup_ephemeral_commands = define_system(
  (query: All<Entity, Has<typeof CommandEntity>>, world: World) => {
    for (const [cmd_ent] of query) {
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
