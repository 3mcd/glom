import {describe, expect, test} from "bun:test"
import {type ComponentResolver, define_component, define_tag} from "./component"
import {ByteReader, ByteWriter} from "./lib/binary"
import {read_message_header, read_snapshot, write_snapshot} from "./protocol"
import {Replicated} from "./replication_config"
import {apply_snapshot_stream, capture_snapshot_stream} from "./snapshot_stream"
import {get_component_value, make_world} from "./world"
import {add_component, advance_tick, spawn} from "./world_api"

describe("snapshot streaming", () => {
  const Position = define_component<{x: number; y: number}>({
    bytes_per_element: 8,
    encode: (val, writer) => {
      writer.write_float32(val.x)
      writer.write_float32(val.y)
    },
    decode: (reader) => {
      return {x: reader.read_float32(), y: reader.read_float32()}
    },
  })

  test("capture and apply snapshot stream", () => {
    const world_a = make_world(1, [Position])
    const world_b = make_world(2, [Position])

    const e1 = spawn(world_a, [Position({x: 10, y: 20}), Replicated])
    const e2 = spawn(world_a, [Position({x: 100, y: 200}), Replicated])
    const e3 = spawn(world_a, [Position({x: 5, y: 5})])

    const pos_id = world_a.component_registry.get_id(Position)
    const blocks = capture_snapshot_stream(world_a, [pos_id])
    expect(blocks.length).toBe(1)
    expect(blocks[0].entities.length).toBe(2)
    expect(blocks[0].entities).toContain(e1 as number)
    expect(blocks[0].entities).toContain(e2 as number)
    expect(blocks[0].entities).not.toContain(e3 as number)

    const writer = new ByteWriter()
    write_snapshot(writer, {tick: 100, blocks}, world_a)

    const reader = new ByteReader(writer.get_bytes())
    const header = read_message_header(reader)
    const message = read_snapshot(reader, header.tick, world_b)
    expect(message.tick).toBe(100)
    expect(message.blocks.length).toBe(1)

    apply_snapshot_stream(world_b, message)

    expect(get_component_value(world_b, e1, Position)?.x).toBe(10)
    expect(get_component_value(world_b, e2, Position)?.x).toBe(100)
    expect(get_component_value(world_b, e3, Position)).toBeUndefined()
  })

  test("LWW versioning in snapshots", () => {
    const world = make_world(1, [Position])
    world.tick = 50
    const entity = spawn(world, [Position({x: 50, y: 50}), Replicated])
    const pos_id = world.component_registry.get_id(Position)

    const old_message = {
      tick: 40,
      blocks: [
        {
          component_id: pos_id,
          entities: [entity as number],
          data: [{x: 40, y: 40}],
        },
      ],
    }
    apply_snapshot_stream(world, old_message)
    expect(get_component_value(world, entity, Position)?.x).toBe(50)

    const new_message = {
      tick: 60,
      blocks: [
        {
          component_id: pos_id,
          entities: [entity as number],
          data: [{x: 60, y: 60}],
        },
      ],
    }
    apply_snapshot_stream(world, new_message)
    expect(get_component_value(world, entity, Position)?.x).toBe(60)
  })
})
