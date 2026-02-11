import {describe, expect, test} from "bun:test"
import {assertDefined} from "./assert"
import * as Command from "./command"
import {CommandBuffer, CommandOf} from "./command"
import type {ComponentSerde} from "./component"
import {type ComponentResolver} from "./component"
import * as Component from "./component"
import type {Entity} from "./entity"
import {ByteReader, ByteWriter} from "./lib/binary"
import {readCommands, readMessageType, writeCommands} from "./protocol"
import {World as WorldTerm} from "./query/term"
import * as SparseMap from "./sparse_map"
import * as System from "./system"
import * as SystemSchedule from "./system_schedule"
import type {World} from "./world"
import * as W from "./world"
import {spawn} from "./world_api"

describe("command api", () => {
  const Jump = Component.defineTag("Jump")
  const Move = Component.define<{x: number; y: number}>("Move")
  const schema = [Jump, Move]

  test("record and execute relational commands", () => {
    const world = W.create({domainId: 1})
    const player = spawn(world)

    Command.record(world, player, Jump, 10)
    Command.record(world, player, Move({x: 5, y: 10}), 10)

    const commandBuffer = W.getResource(world, CommandBuffer)
    expect(commandBuffer?.get(10)?.length).toBe(2)

    let jumpFound = false
    let moveVal: {x: number; y: number} | undefined

    world.tick = 10

    const schedule = SystemSchedule.create()
    SystemSchedule.add(schedule, Command.spawnEphemeralCommands)

    const checkSystem = System.define(
      (_world: World) => {
        const node = SparseMap.get(world.graph.byEntity, player as number)
        expect(node).toBeDefined()
        if (node) {
          for (const comp of node.vec.elements) {
            const compId = world.componentRegistry.getId(comp)
            const rel = world.relations.virtualToRel.get(compId)
            if (
              rel &&
              rel.relationId === world.componentRegistry.getId(CommandOf)
            ) {
              const cmdEnt = rel.object

              const cmdNode = SparseMap.get(
                world.graph.byEntity,
                cmdEnt as number,
              )
              const jumpId = world.componentRegistry.getId(Jump)
              if (
                cmdNode?.vec.elements.some(
                  (c) => world.componentRegistry.getId(c) === jumpId,
                )
              ) {
                jumpFound = true
              }

              const move = W.getComponentValue(world, cmdEnt as Entity, Move)
              if (move !== undefined) moveVal = move
            }
          }
        }
      },
      {params: [WorldTerm()], name: "check"},
    )

    SystemSchedule.add(schedule, checkSystem)
    SystemSchedule.add(schedule, Command.cleanupEphemeralCommands)

    SystemSchedule.run(schedule, world)

    expect(jumpFound).toBe(true)
    expect(moveVal).toEqual({x: 5, y: 10})

    expect(
      SparseMap.get(world.graph.byEntity, player as number)?.vec.elements.length,
    ).toBe(0)
  })

  test("binary serialization", () => {
    const resolver: ComponentResolver = {
      getSerde: (id: number): ComponentSerde<any> | undefined => {
        if (id === 101) {
          return {
            bytesPerElement: 8,
            encode: (val: {x: number; y: number}, writer: ByteWriter) => {
              writer.writeFloat32(val.x)
              writer.writeFloat32(val.y)
            },
            decode: (reader: ByteReader) => {
              return {x: reader.readFloat32(), y: reader.readFloat32()}
            },
          }
        }
        return undefined
      },
      isTag: (id) => id === 100,
    }

    const commands = [
      {target: 1, componentId: 100, data: undefined},
      {target: 1, componentId: 101, data: {x: 1.5, y: 2.5}},
    ]

    const writer = new ByteWriter()
    writeCommands(writer, 50, commands, resolver)

    const reader = new ByteReader(writer.getBytes())
    readMessageType(reader) // MessageType.Command
    const tick = reader.readUint32()
    const result = readCommands(reader, resolver)

    const [cmd0, cmd1] = result
    assertDefined(cmd0)
    assertDefined(cmd1)

    expect(tick).toBe(50)
    expect(result.length).toBe(2)
    expect(cmd0.target).toBe(1)
    expect(cmd0.componentId).toBe(100)
    expect(cmd1.componentId).toBe(101)
    expect((cmd1.data as {x: number}).x).toBeCloseTo(1.5, 5)
  })

  test("pruning", () => {
    const world = W.create({domainId: 1})
    const player = spawn(world)
    Command.record(world, player, Jump, 10)
    Command.record(world, player, Jump, 20)

    Command.pruneCommands(world, 15)

    const commandBuffer = W.getResource(world, CommandBuffer)
    expect(commandBuffer?.has(10)).toBe(false)
    expect(commandBuffer?.has(20)).toBe(true)
  })
})
