import {describe, expect, test} from "bun:test"
import {defineComponent} from "./component"
import {ByteReader, ByteWriter} from "./lib/binary"
import {readMessageHeader, readSnapshot} from "./protocol"
import {Replicated} from "./replication_config"
import {
  applySnapshotStream,
  applySnapshotStreamVersioned,
  writeSnapshot,
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

  test("capture and apply snapshot via binary round-trip", () => {
    const worldA = makeWorld({domainId: 1, schema: [Position]})
    const worldB = makeWorld({domainId: 2, schema: [Position]})

    const e1 = spawn(worldA, Position({x: 10, y: 20}), Replicated)
    const e2 = spawn(worldA, Position({x: 100, y: 200}), Replicated)
    const e3 = spawn(worldA, Position({x: 5, y: 5}))

    const posId = worldA.componentRegistry.getId(Position)

    // Write snapshot to binary
    const writer = new ByteWriter()
    writeSnapshot(writer, worldA, [posId], worldA, 100)
    const bytes = writer.getBytes()

    // Read snapshot from binary
    const reader = new ByteReader(bytes)
    const header = readMessageHeader(reader)
    expect(header.tick).toBe(100)
    const message = readSnapshot(reader, header.tick)

    // Apply to worldB
    // First spawn entities in worldB so they exist
    spawn(worldB, Position({x: 0, y: 0})) // e1 placeholder
    spawn(worldB, Position({x: 0, y: 0})) // e2 placeholder
    applySnapshotStream(worldB, message)

    expect(getComponentValue(worldB, e1, Position)?.x).toBeCloseTo(10)
    expect(getComponentValue(worldB, e2, Position)?.x).toBeCloseTo(100)
    expect(getComponentValue(worldB, e3, Position)).toBeUndefined()
  })

  test("authoritative snapshots always overwrite (forceSet)", () => {
    const world = makeWorld({domainId: 1, schema: [Position]})
    world.tick = 50
    const entity = spawn(world, Position({x: 50, y: 50}), Replicated)
    const posId = world.componentRegistry.getId(Position)

    // Create a snapshot with an older tick
    const writer = new ByteWriter()
    // Write a manual snapshot body (blockCount=1, componentId, entityCount=1, entity, data)
    writeSnapshot(writer, world, [posId], world, 40)
    // The snapshot captured the current value (50,50).
    // Overwrite the entity's value so we can test that the older snapshot still applies.
    const pos = getComponentValue(world, entity, Position)!
    pos.x = 999
    pos.y = 999

    const reader = new ByteReader(writer.getBytes())
    const header = readMessageHeader(reader)
    const message = readSnapshot(reader, header.tick)
    applySnapshotStream(world, message)

    // Authoritative: always overwrites, even with older tick
    expect(getComponentValue(world, entity, Position)?.x).toBeCloseTo(50)
  })

  test("versioned snapshots respect LWW (P2P)", () => {
    const world = makeWorld({domainId: 1, schema: [Position]})
    world.tick = 50
    const entity = spawn(world, Position({x: 50, y: 50}), Replicated)
    const posId = world.componentRegistry.getId(Position)

    // Capture the current state as an "old" snapshot at tick 40
    const oldWriter = new ByteWriter()
    writeSnapshot(oldWriter, world, [posId], world, 40)
    // Mutate the live value so it differs from the snapshot
    const pos = getComponentValue(world, entity, Position)!
    pos.x = 999
    pos.y = 999

    const oldReader = new ByteReader(oldWriter.getBytes())
    const oldHeader = readMessageHeader(oldReader)
    const oldMessage = readSnapshot(oldReader, oldHeader.tick)
    applySnapshotStreamVersioned(world, oldMessage)

    // Versioned: older tick (40) does NOT overwrite current version (50)
    expect(getComponentValue(world, entity, Position)?.x).toBeCloseTo(999)

    // Now capture a "new" snapshot at tick 60
    const newWriter = new ByteWriter()
    writeSnapshot(newWriter, world, [posId], world, 60)

    const newReader = new ByteReader(newWriter.getBytes())
    const newHeader = readMessageHeader(newReader)
    const newMessage = readSnapshot(newReader, newHeader.tick)
    applySnapshotStreamVersioned(world, newMessage)

    // Versioned: newer tick (60) overwrites
    expect(getComponentValue(world, entity, Position)?.x).toBeCloseTo(999)
  })
})
