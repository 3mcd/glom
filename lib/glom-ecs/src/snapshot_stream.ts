import {Replicated} from "./replication_config"
import {getComponentValue, setComponentValue, type World} from "./world"
import type {SnapshotBlock, SnapshotMessage} from "./net_types"
import type {Entity} from "./entity"
import type {ComponentLike} from "./component"

export function captureSnapshotStream(
  world: World,
  componentIds: number[],
): SnapshotBlock[] {
  const blocks: SnapshotBlock[] = []

  const replicatedEntities: Entity[] = []
  const nodes = Array.from(world.entityGraph.byHash.values())
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    let isReplicated = false
    const elements = node.vec.elements
    for (let j = 0; j < elements.length; j++) {
      if (world.componentRegistry.getId(elements[j]!) === Replicated.id) {
        isReplicated = true
        break
      }
    }
    if (isReplicated) {
      const entities = node.entities.dense
      for (let j = 0; j < entities.length; j++) {
        replicatedEntities.push(entities[j] as Entity)
      }
    }
  }

  if (replicatedEntities.length === 0) return blocks

  for (let i = 0; i < componentIds.length; i++) {
    const compId = componentIds[i]!
    const blockEntities: number[] = []
    const blockData: unknown[] = []

    const comp = {
      id: compId,
      __component_brand: true,
    } as unknown as ComponentLike

    for (let j = 0; j < replicatedEntities.length; j++) {
      const entity = replicatedEntities[j]!
      const val = getComponentValue(world, entity, comp)
      if (val !== undefined) {
        blockEntities.push(entity as number)
        blockData.push(val)
      }
    }

    if (blockEntities.length > 0) {
      blocks.push({
        componentId: compId,
        entities: blockEntities,
        data: blockData,
      })
    }
  }

  return blocks
}

export function applySnapshotStream(world: World, message: SnapshotMessage) {
  const blocks = message.blocks
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!
    const comp = {
      id: block.componentId,
      __component_brand: true,
    } as unknown as ComponentLike
    const entities = block.entities
    for (let j = 0; j < entities.length; j++) {
      const entity = entities[j]! as Entity
      const data = block.data[j]

      setComponentValue(world, entity, comp, data, message.tick)
    }
  }
}
