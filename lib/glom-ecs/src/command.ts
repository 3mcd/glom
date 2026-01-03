import type { ComponentInstance, ComponentLike } from "./component"
import { define_component, define_tag } from "./component"
import type { Entity } from "./entity"
import { define_relation } from "./relation"
import type { World } from "./world"

export const CommandOf = define_relation(1001)
export const CommandEntity = define_tag(1002)

export const IntentTick = define_component<number>(1003, {
  bytes_per_element: 4,
  encode: (val, buf, off) => {
    new DataView(buf.buffer, buf.byteOffset + off).setUint32(0, val, true)
  },
  decode: (buf, off) => {
    return new DataView(buf.buffer, buf.byteOffset + off).getUint32(0, true)
  },
})

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
      component_id: inst.component.id,
      data: inst.value,
      intent_tick,
    })
  } else {
    const comp = command as ComponentLike
    list.push({
      target,
      component_id: comp.id,
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
