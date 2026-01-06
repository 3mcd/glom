import {describe, expect, test} from "bun:test"
import {assertDefined} from "./assert"
import {
  CommandBuffer,
  CommandOf,
  cleanupEphemeralCommands,
  pruneCommands,
  recordCommand,
  spawnEphemeralCommands,
} from "./command"
import type {ComponentSerde} from "./component"
import {type ComponentResolver, defineComponent, defineTag} from "./component"
import type {Entity} from "./entity"
import {ByteReader, ByteWriter} from "./lib/binary"
import {readCommands, readMessageHeader, writeCommands} from "./protocol"
import {All} from "./query/all"
import {Read, World as WorldTerm} from "./query/term"
import {sparseMapGet} from "./sparse_map"
import {defineSystem} from "./system"
import {addSystem, makeSystemSchedule, runSchedule} from "./system_schedule"
import type {World} from "./world"
import {getComponentValue, getResource, makeWorld} from "./world"
import {spawn} from "./world_api"

describe("command api", () => {
  const Jump = defineTag()
  const Move = defineComponent<{x: number; y: number}>()
  const schema = [Jump, Move]

  test("record and execute relational commands", () => {
    const world = makeWorld({domainId: 1, schema})
    const player = spawn(world, [])

    recordCommand(world, player, Jump, 10)
    recordCommand(world, player, Move({x: 5, y: 10}), 10)

    const commandBuffer = getResource(world, CommandBuffer)
    expect(commandBuffer?.get(10)?.length).toBe(2)

    let jumpFound = false
    let moveVal: {x: number; y: number} | undefined

    world.tick = 10

    const schedule = makeSystemSchedule()
    addSystem(schedule, spawnEphemeralCommands)

    const checkSystem = defineSystem(
      (_world: World) => {
        const node = sparseMapGet(world.entityGraph.byEntity, player as number)
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

              const cmdNode = sparseMapGet(
                world.entityGraph.byEntity,
                cmdEnt as number,
              )
              const jumpId = world.componentRegistry.getId(Jump)
              if (
                cmdNode &&
                cmdNode.vec.elements.some(
                  (c) => world.componentRegistry.getId(c) === jumpId,
                )
              ) {
                jumpFound = true
              }

              const move = getComponentValue(world, cmdEnt as Entity, Move)
              if (move !== undefined) moveVal = move
            }
          }
        }
      },
      {params: [WorldTerm()], name: "check"},
    )

    addSystem(schedule, checkSystem)
    addSystem(schedule, cleanupEphemeralCommands)

    runSchedule(schedule, world)

    expect(jumpFound).toBe(true)
    expect(moveVal).toEqual({x: 5, y: 10})

    expect(
      sparseMapGet(world.entityGraph.byEntity, player as number)?.vec.elements
        .length,
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
    writeCommands(writer, {tick: 50, commands}, resolver)

    const reader = new ByteReader(writer.getBytes())
    const header = readMessageHeader(reader)
    const result = readCommands(reader, header.tick, resolver)

    const [cmd0, cmd1] = result.commands
    assertDefined(cmd0)
    assertDefined(cmd1)

    expect(result.tick).toBe(50)
    expect(result.commands.length).toBe(2)
    expect(cmd0.target).toBe(1)
    expect(cmd0.componentId).toBe(100)
    expect(cmd1.componentId).toBe(101)
    expect((cmd1.data as {x: number}).x).toBeCloseTo(1.5, 5)
  })

  test("pruning", () => {
    const world = makeWorld({domainId: 1, schema})
    const player = spawn(world, [])
    recordCommand(world, player, Jump, 10)
    recordCommand(world, player, Jump, 20)

    pruneCommands(world, 15)

    const commandBuffer = getResource(world, CommandBuffer)
    expect(commandBuffer?.has(10)).toBe(false)
    expect(commandBuffer?.has(20)).toBe(true)
  })
})
