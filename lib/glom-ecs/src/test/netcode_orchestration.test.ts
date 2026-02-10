import {describe, expect, test} from "bun:test"
import * as commands from "../command"
import {defineComponent, defineTag} from "../component"
import {All, type Join} from "../query/all"
import * as replication from "../replication"
import {Replicated} from "../replication_config"
import {sparseMapGet} from "../sparse_map"
import {defineSystem} from "../system"
import {addSystem, makeSystemSchedule, runSchedule} from "../system_schedule"
import {getComponentValue, makeWorld} from "../world"
import {spawn} from "../world_api"

describe("netcode orchestration", () => {
  const Position = defineComponent<{x: number; y: number}>("Position")
  const Jump = defineTag("Jump")
  const schema = [Position, Jump]

  test("networked schedule lifecycle", () => {
    const world = makeWorld({domainId: 1})
    const player = spawn(world, Position({x: 0, y: 0}), Replicated)

    const schedule = makeSystemSchedule()

    addSystem(schedule, commands.spawnEphemeralCommands)

    const jumpSystem = defineSystem(
      (
        playerQuery: Join<
          All<typeof Position>,
          All<typeof Jump>,
          typeof commands.CommandOf
        >,
      ) => {
        for (const [pos, _jump] of playerQuery) {
          ;(pos as {y: number}).y += 10
        }
      },
      {
        params: [
          {
            join: [All(Position), All(Jump), commands.CommandOf],
          },
        ],
        name: "jumpSystem",
      },
    )

    addSystem(schedule, jumpSystem)

    addSystem(schedule, commands.cleanupEphemeralCommands)
    addSystem(schedule, replication.commitPendingMutations)
    addSystem(schedule, replication.advanceWorldTick)

    commands.recordCommand(world, player, Jump, 0)

    runSchedule(schedule, world)

    expect(world.tick).toBe(1)
    expect(getComponentValue(world, player, Position)?.y).toBe(10)

    const node = sparseMapGet(world.entityGraph.byEntity, player as number)
    const commandOfId = world.componentRegistry.getId(commands.CommandOf)
    expect(
      node?.vec.elements.some(
        (c) => world.componentRegistry.getId(c) === commandOfId,
      ),
    ).toBe(false)
  })
})
