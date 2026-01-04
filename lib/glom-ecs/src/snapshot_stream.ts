import {Replicated} from "./replication_config"
import {get_component_value, set_component_value, type World} from "./world"
import type {SnapshotBlock, SnapshotMessage} from "./net_types"
import type {Entity} from "./entity"
import type {ComponentLike} from "./component"

export function capture_snapshot_stream(
  world: World,
  component_ids: number[],
): SnapshotBlock[] {
  const blocks: SnapshotBlock[] = []

  const replicated_entities: Entity[] = []
  const nodes = Array.from(world.entity_graph.by_hash.values())
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    let is_replicated = false
    const elements = node.vec.elements
    for (let j = 0; j < elements.length; j++) {
      if (world.component_registry.get_id(elements[j]!) === Replicated.id) {
        is_replicated = true
        break
      }
    }
    if (is_replicated) {
      const entities = node.entities.dense
      for (let j = 0; j < entities.length; j++) {
        replicated_entities.push(entities[j] as Entity)
      }
    }
  }

  if (replicated_entities.length === 0) return blocks

  for (let i = 0; i < component_ids.length; i++) {
    const comp_id = component_ids[i]!
    const block_entities: number[] = []
    const block_data: unknown[] = []

    const comp = {
      id: comp_id,
      __component_brand: true,
    } as unknown as ComponentLike

    for (let j = 0; j < replicated_entities.length; j++) {
      const entity = replicated_entities[j]!
      const val = get_component_value(world, entity, comp)
      if (val !== undefined) {
        block_entities.push(entity as number)
        block_data.push(val)
      }
    }

    if (block_entities.length > 0) {
      blocks.push({
        component_id: comp_id,
        entities: block_entities,
        data: block_data,
      })
    }
  }

  return blocks
}

export function apply_snapshot_stream(world: World, message: SnapshotMessage) {
  const blocks = message.blocks
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!
    const comp = {
      id: block.component_id,
      __component_brand: true,
    } as unknown as ComponentLike
    const entities = block.entities
    for (let j = 0; j < entities.length; j++) {
      const entity = entities[j]! as Entity
      const data = block.data[j]

      set_component_value(world, entity, comp, data, message.tick)
    }
  }
}
