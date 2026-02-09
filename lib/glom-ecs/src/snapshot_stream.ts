import type {ComponentResolver} from "./component"
import {ByteReader, type ByteWriter} from "./lib/binary"
import type {SnapshotBlock, SnapshotMessage} from "./net_types"
import {MessageType, type ResolverLike, writeMessageHeader} from "./protocol"
import {Replicated} from "./replication_config"
import {
  forceSetComponentValueById,
  getComponentValueById,
  setComponentValueById,
  type World,
} from "./world"

function toResolver(res: ResolverLike): ComponentResolver {
  return "componentRegistry" in res ? res.componentRegistry : res
}

// Reusable buffers to avoid per-call allocations
const _replicatedEntities: number[] = []
const _entityCounts: number[] = []
const _sharedReader = new ByteReader(new Uint8Array(0))

/**
 * Collect replicated entities from the world into the reusable _replicatedEntities buffer.
 * Returns the count of entities found.
 */
function collectReplicatedEntities(
  world: World,
  entityFilter?: (entity: number) => boolean,
): number {
  _replicatedEntities.length = 0
  for (const node of world.entityGraph.byHash.values()) {
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
        const entity = entities[j] as number
        if (!entityFilter || entityFilter(entity)) {
          _replicatedEntities.push(entity)
        }
      }
    }
  }
  return _replicatedEntities.length
}

export function captureSnapshotStream(
  world: World,
  componentIds: number[],
  entityFilter?: (entity: number) => boolean,
): SnapshotBlock[] {
  const blocks: SnapshotBlock[] = []

  const count = collectReplicatedEntities(world, entityFilter)
  if (count === 0) return blocks

  for (let i = 0; i < componentIds.length; i++) {
    const compId = componentIds[i]!
    const blockEntities: number[] = []
    const blockData: unknown[] = []

    for (let j = 0; j < count; j++) {
      const entity = _replicatedEntities[j]!
      const val = getComponentValueById(world, entity, compId)
      if (val !== undefined) {
        blockEntities.push(entity)
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

/**
 * Capture snapshot data from the world and write directly to a ByteWriter,
 * bypassing all intermediate SnapshotBlock/SnapshotMessage allocations.
 * Produces the same binary format as writeSnapshot().
 */
export function writeSnapshotDirect(
  writer: ByteWriter,
  world: World,
  componentIds: number[],
  resolverLike: ResolverLike,
  tick: number,
  entityFilter?: (entity: number) => boolean,
): void {
  const resolver = toResolver(resolverLike)
  const entityCount = collectReplicatedEntities(world, entityFilter)

  // Pass 1: count blocks and entities per component
  let blockCount = 0
  if (_entityCounts.length < componentIds.length) {
    _entityCounts.length = componentIds.length
  }
  for (let i = 0; i < componentIds.length; i++) {
    const compId = componentIds[i]!
    let n = 0
    for (let j = 0; j < entityCount; j++) {
      if (
        getComponentValueById(world, _replicatedEntities[j]!, compId) !==
        undefined
      ) {
        n++
      }
    }
    _entityCounts[i] = n
    if (n > 0) blockCount++
  }

  // Pass 2: write
  writeMessageHeader(writer, MessageType.Snapshot, tick)
  writer.writeUint16(blockCount)

  for (let i = 0; i < componentIds.length; i++) {
    if (_entityCounts[i] === 0) continue
    const compId = componentIds[i]!
    writer.writeVarint(compId)
    writer.writeUint16(_entityCounts[i]!)

    const serde = resolver.getSerde(compId)
    const isTag = resolver.isTag(compId)

    for (let j = 0; j < entityCount; j++) {
      const entity = _replicatedEntities[j]!
      const val = getComponentValueById(world, entity, compId)
      if (val !== undefined) {
        writer.writeVarint(entity)
        if (!isTag && serde) {
          serde.encode(val, writer)
        }
      }
    }
  }
}

/**
 * Read snapshot body from a ByteReader and apply directly to the world,
 * bypassing intermediate SnapshotBlock/SnapshotMessage allocations.
 * @param force If true, uses forceSetComponentValueById (authoritative). If false, uses LWW.
 */
function readAndApplySnapshotDirect(
  world: World,
  reader: ByteReader,
  tick: number,
  force: boolean,
): void {
  const resolver = world.componentRegistry
  const blockCount = reader.readUint16()

  for (let i = 0; i < blockCount; i++) {
    const componentId = reader.readVarint()
    const entityCount = reader.readUint16()
    const serde = resolver.getSerde(componentId)
    const isTag = resolver.isTag(componentId)

    for (let j = 0; j < entityCount; j++) {
      const entity = reader.readVarint()
      if (!isTag && serde) {
        const data = serde.decode(reader, undefined as unknown)
        if (force) {
          forceSetComponentValueById(world, entity, componentId, data, tick)
        } else {
          setComponentValueById(world, entity, componentId, data, tick)
        }
      }
      // Tags/no-serde: no data in buffer, nothing to apply
    }
  }
}

export function applySnapshotStream(world: World, message: SnapshotMessage) {
  if (message._raw) {
    _sharedReader.reset(message._raw)
    readAndApplySnapshotDirect(world, _sharedReader, message.tick, true)
    return
  }
  const blocks = message.blocks
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!
    const componentId = block.componentId
    const entities = block.entities
    for (let j = 0; j < entities.length; j++) {
      const entity = entities[j]!
      const data = block.data[j]
      forceSetComponentValueById(
        world,
        entity as number,
        componentId,
        data,
        message.tick,
      )
    }
  }
}

/**
 * Like `applySnapshotStream` but uses version-checked `setComponentValue`
 * instead of `forceSetComponentValue`. Stale snapshots from slower peers
 * will not overwrite newer local state. Intended for P2P topologies.
 */
export function applySnapshotStreamVersioned(
  world: World,
  message: SnapshotMessage,
) {
  if (message._raw) {
    _sharedReader.reset(message._raw)
    readAndApplySnapshotDirect(world, _sharedReader, message.tick, false)
    return
  }
  const blocks = message.blocks
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!
    const componentId = block.componentId
    const entities = block.entities
    for (let j = 0; j < entities.length; j++) {
      const entity = entities[j]!
      const data = block.data[j]
      setComponentValueById(
        world,
        entity as number,
        componentId,
        data,
        message.tick,
      )
    }
  }
}
