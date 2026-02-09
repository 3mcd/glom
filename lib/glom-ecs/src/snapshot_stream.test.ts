import {describe, expect, test} from "bun:test"
import {defineComponent} from "./component"
import {ByteReader, ByteWriter} from "./lib/binary"
import {readMessageHeader, readSnapshot, writeSnapshot} from "./protocol"
import {Replicated} from "./replication_config"
import {
  applySnapshotStream,
  applySnapshotStreamVersioned,
  captureSnapshotStream,
} from "./snapshot_stream"
import {getComponentValue, makeWorld} from "./world"
import {spawn} from "./world_api"

describe("snapshot streaming", () => {
  const Position = defineComponent<{x: number; y: number}>({
    bytesPerElement: 8,
    encode: (val, writer) => {
      writer.writeFloat32(val.x)
      writer.writeFloat32(val.y)
    },
    decode: (reader) => {
      return {x: reader.readFloat32(), y: reader.readFloat32()}
    },
  })

  test("capture and apply snapshot stream", () => {
    const worldA = makeWorld({domainId: 1, schema: [Position]})
    const worldB = makeWorld({domainId: 2, schema: [Position]})

    const e1 = spawn(worldA, Position({x: 10, y: 20}), Replicated)
    const e2 = spawn(worldA, Position({x: 100, y: 200}), Replicated)
    const e3 = spawn(worldA, Position({x: 5, y: 5}))

    const posId = worldA.componentRegistry.getId(Position)
    const blocks = captureSnapshotStream(worldA, [posId])
    expect(blocks.length).toBe(1)
    expect(blocks[0].entities.length).toBe(2)
    expect(blocks[0].entities).toContain(e1 as number)
    expect(blocks[0].entities).toContain(e2 as number)
    expect(blocks[0].entities).not.toContain(e3 as number)

    const writer = new ByteWriter()
    writeSnapshot(writer, {tick: 100, blocks}, worldA)

    const reader = new ByteReader(writer.getBytes())
    const header = readMessageHeader(reader)
    const message = readSnapshot(reader, header.tick, worldB)
    expect(message.tick).toBe(100)
    expect(message.blocks.length).toBe(1)

    applySnapshotStream(worldB, message)

    expect(getComponentValue(worldB, e1, Position)?.x).toBe(10)
    expect(getComponentValue(worldB, e2, Position)?.x).toBe(100)
    expect(getComponentValue(worldB, e3, Position)).toBeUndefined()
  })

  test("authoritative snapshots always overwrite (forceSet)", () => {
    const world = makeWorld({domainId: 1, schema: [Position]})
    world.tick = 50
    const entity = spawn(world, Position({x: 50, y: 50}), Replicated)
    const posId = world.componentRegistry.getId(Position)

    const oldMessage = {
      tick: 40,
      blocks: [
        {
          componentId: posId,
          entities: [entity as number],
          data: [{x: 40, y: 40}],
        },
      ],
    }
    applySnapshotStream(world, oldMessage)
    // Authoritative: always overwrites, even with older tick
    expect(getComponentValue(world, entity, Position)?.x).toBe(40)
  })

  test("versioned snapshots respect LWW (P2P)", () => {
    const world = makeWorld({domainId: 1, schema: [Position]})
    world.tick = 50
    const entity = spawn(world, Position({x: 50, y: 50}), Replicated)
    const posId = world.componentRegistry.getId(Position)

    const oldMessage = {
      tick: 40,
      blocks: [
        {
          componentId: posId,
          entities: [entity as number],
          data: [{x: 40, y: 40}],
        },
      ],
    }
    applySnapshotStreamVersioned(world, oldMessage)
    // Versioned: older tick does NOT overwrite
    expect(getComponentValue(world, entity, Position)?.x).toBe(50)

    const newMessage = {
      tick: 60,
      blocks: [
        {
          componentId: posId,
          entities: [entity as number],
          data: [{x: 60, y: 60}],
        },
      ],
    }
    applySnapshotStreamVersioned(world, newMessage)
    // Versioned: newer tick overwrites
    expect(getComponentValue(world, entity, Position)?.x).toBe(60)
  })
})
