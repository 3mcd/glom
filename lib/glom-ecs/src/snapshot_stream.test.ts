import {describe, expect, test} from "bun:test"
import * as Component from "./component"
import {ByteReader, ByteWriter} from "./lib/binary"
import {readMessageType, readSnapshot} from "./protocol"
import {Replicated} from "./replication_config"
import {
  applySnapshotStream,
  applySnapshotStreamVersioned,
  writeSnapshot,
} from "./snapshot_stream"
import * as World from "./world"
import {spawn} from "./world_api"

describe("snapshot streaming", () => {
  const Position = Component.define<{x: number; y: number}>("Position", {
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
    const worldA = World.create({domainId: 1})
    const worldB = World.create({domainId: 2})

    const e1 = spawn(worldA, Position({x: 10, y: 20}), Replicated)
    const e2 = spawn(worldA, Position({x: 100, y: 200}), Replicated)
    const e3 = spawn(worldA, Position({x: 5, y: 5}))

    const posId = worldA.componentRegistry.getId(Position)

    // Write snapshot to binary
    const writer = new ByteWriter()
    writeSnapshot(writer, worldA, [posId], worldA.componentRegistry, 100)
    const bytes = writer.getBytes()

    // Read snapshot from binary
    const reader = new ByteReader(bytes)
    readMessageType(reader) // MessageType.Snapshot
    const tick = reader.readUint32()
    expect(tick).toBe(100)
    const message = readSnapshot(reader, tick)

    // Apply to worldB
    // First spawn entities in worldB so they exist
    spawn(worldB, Position({x: 0, y: 0})) // e1 placeholder
    spawn(worldB, Position({x: 0, y: 0})) // e2 placeholder
    applySnapshotStream(worldB, message)

    expect(World.getComponentValue(worldB, e1, Position)?.x).toBeCloseTo(10)
    expect(World.getComponentValue(worldB, e2, Position)?.x).toBeCloseTo(100)
    expect(World.getComponentValue(worldB, e3, Position)).toBeUndefined()
  })

  test("authoritative snapshots always overwrite (forceSet)", () => {
    const world = World.create({domainId: 1})
    world.tick = 50
    const entity = spawn(world, Position({x: 50, y: 50}), Replicated)
    const posId = world.componentRegistry.getId(Position)

    // Create a snapshot with an older tick
    const writer = new ByteWriter()
    // Write a manual snapshot body (blockCount=1, componentId, entityCount=1, entity, data)
    writeSnapshot(writer, world, [posId], world.componentRegistry, 40)
    // The snapshot captured the current value (50,50).
    // Overwrite the entity's value so we can test that the older snapshot still applies.
    const pos = World.getComponentValue(world, entity, Position)!
    pos.x = 999
    pos.y = 999

    const reader = new ByteReader(writer.getBytes())
    readMessageType(reader) // MessageType.Snapshot
    const tick = reader.readUint32()
    const message = readSnapshot(reader, tick)
    applySnapshotStream(world, message)

    // Authoritative: always overwrites, even with older tick
    expect(World.getComponentValue(world, entity, Position)?.x).toBeCloseTo(50)
  })

  test("versioned snapshots respect LWW (P2P)", () => {
    const world = World.create({domainId: 1})
    world.tick = 50
    const entity = spawn(world, Position({x: 50, y: 50}), Replicated)
    const posId = world.componentRegistry.getId(Position)

    // Capture the current state as an "old" snapshot at tick 40
    const oldWriter = new ByteWriter()
    writeSnapshot(oldWriter, world, [posId], world.componentRegistry, 40)
    // Mutate the live value so it differs from the snapshot
    const pos = World.getComponentValue(world, entity, Position)!
    pos.x = 999
    pos.y = 999

    const oldReader = new ByteReader(oldWriter.getBytes())
    readMessageType(oldReader) // MessageType.Snapshot
    const oldTick = oldReader.readUint32()
    const oldMessage = readSnapshot(oldReader, oldTick)
    applySnapshotStreamVersioned(world, oldMessage)

    // Versioned: older tick (40) does NOT overwrite current version (50)
    expect(World.getComponentValue(world, entity, Position)?.x).toBeCloseTo(999)

    // Now capture a "new" snapshot at tick 60
    const newWriter = new ByteWriter()
    writeSnapshot(newWriter, world, [posId], world.componentRegistry, 60)

    const newReader = new ByteReader(newWriter.getBytes())
    readMessageType(newReader) // MessageType.Snapshot
    const newTick = newReader.readUint32()
    const newMessage = readSnapshot(newReader, newTick)
    applySnapshotStreamVersioned(world, newMessage)

    // Versioned: newer tick (60) overwrites
    expect(World.getComponentValue(world, entity, Position)?.x).toBeCloseTo(999)
  })
})
