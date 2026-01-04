import { describe, expect, test } from "bun:test"
import { record_command, prune_commands, CommandOf } from "./command"
import { define_component, define_tag } from "./component"
import { define_system } from "./system"
import { sparse_map_get } from "./sparse_map"
import { make_world, get_component_value } from "./world"
import { spawn } from "./world_api"
import { ByteReader, ByteWriter } from "./lib/binary"
import { write_commands, read_commands, read_message_header, type ComponentResolver } from "./protocol"
import type { ComponentSerde } from "./component"
import { All } from "./query/all"
import { Rel, Read, World as WorldTerm } from "./query/term"
import { GlomNetwork } from "./netcode"
import { run_schedule, make_system_schedule, add_system } from "./system_schedule"

describe("command api", () => {
  const Jump = define_tag()
  const Move = define_component<{ x: number; y: number }>()
  const schema = [Jump, Move]

  test("record and execute relational commands", () => {
    const world = make_world(1, schema)
    const player = spawn(world, [])
    
    record_command(world, player, Jump, 10)
    record_command(world, player, Move({ x: 5, y: 10 }), 10)

    expect(world.command_buffer.get(10)?.length).toBe(2)

    let jump_found = false
    let move_val: { x: number; y: number } | undefined

    world.tick = 10
    
    const schedule = make_system_schedule()
    add_system(schedule, GlomNetwork.commands.spawn_ephemeral_commands)
    
    const check_system = define_system((
      // @ts-ignore
      q: All<Read<typeof Position>, Rel<typeof CommandOf, Read<typeof Jump>>>
    ) => {
      const node = sparse_map_get(world.entity_graph.by_entity, player as number)
      expect(node).toBeDefined()
      if (node) {
        for (const comp of node.vec.elements) {
          const comp_id = world.component_registry.get_id(comp)
          const rel = world.relations.virtual_to_rel.get(comp_id)
          if (rel && rel.relation_id === world.component_registry.get_id(CommandOf)) {
            const cmd_ent = rel.object
            
            // Check if cmd_ent has the tag Jump
            const cmd_node = sparse_map_get(world.entity_graph.by_entity, cmd_ent as number)
            const jump_id = world.component_registry.get_id(Jump)
            if (cmd_node && cmd_node.vec.elements.some(c => world.component_registry.get_id(c) === jump_id)) {
              jump_found = true
            }
            
              const move = get_component_value(
                world,
                cmd_ent as g.Entity,
                Move,
              )
            if (move !== undefined) move_val = move
          }
        }
      }
    }, { params: [WorldTerm()], name: "check" })

    add_system(schedule, check_system)
    add_system(schedule, GlomNetwork.commands.cleanup_ephemeral_commands)

    run_schedule(schedule, world)

    expect(jump_found).toBe(true)
    expect(move_val).toEqual({ x: 5, y: 10 })

    // Verify cleanup
    expect(sparse_map_get(world.entity_graph.by_entity, player as number)?.vec.elements.length).toBe(0)
  })

  test("binary serialization", () => {
    const resolver: ComponentResolver = {
      get_serde: (id) => {
        if (id === 101) {
          return {
            bytes_per_element: 8,
            encode: (val: { x: number; y: number }, buf: Uint8Array, off: number) => {
              const view = new DataView(buf.buffer, buf.byteOffset + off)
              view.setFloat32(0, val.x, true)
              view.setFloat32(4, val.y, true)
            },
            decode: (buf: Uint8Array, off: number) => {
              const view = new DataView(buf.buffer, buf.byteOffset + off)
              return { x: view.getFloat32(0, true), y: view.getFloat32(4, true) }
            }
          } as ComponentSerde<{ x: number; y: number }>
        }
        return undefined
      },
      is_tag: (id) => id === 100
    }

    const commands = [
      { target: 1, component_id: 100, data: undefined },
      { target: 1, component_id: 101, data: { x: 1.5, y: 2.5 } }
    ]

    const writer = new ByteWriter()
    write_commands(writer, { tick: 50, commands }, resolver)

    const reader = new ByteReader(writer.get_bytes())
    const header = read_message_header(reader)
    const result = read_commands(reader, header.tick, resolver)

    expect(result.tick).toBe(50)
    expect(result.commands.length).toBe(2)
    expect(result.commands[0].target).toBe(1)
    expect(result.commands[0].component_id).toBe(100)
    expect(result.commands[1].component_id).toBe(101)
    expect((result.commands[1].data as { x: number }).x).toBeCloseTo(1.5, 5)
  })

  test("pruning", () => {
    const world = make_world(1, schema)
    const player = spawn(world, [])
    record_command(world, player, Jump, 10)
    record_command(world, player, Jump, 20)
    
    prune_commands(world, 15)
    
    expect(world.command_buffer.has(10)).toBe(false)
    expect(world.command_buffer.has(20)).toBe(true)
  })
})

