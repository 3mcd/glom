import {describe, expect, test} from "bun:test"
import * as commands from "../command"
import * as Component from "../component"
import {All, type Join} from "../query/all"
import * as replication from "../replication"
import {Replicated} from "../replication_config"
import * as SparseMap from "../sparse_map"
import * as System from "../system"
import * as SystemSchedule from "../system_schedule"
import * as World from "../world"
import {spawn} from "../world_api"

describe("netcode orchestration", () => {
  const Position = Component.define<{x: number; y: number}>("Position")
  const Jump = Component.defineTag("Jump")
  const schema = [Position, Jump]

  test("networked schedule lifecycle", () => {
    const world = World.create({domainId: 1})
    const player = spawn(world, Position({x: 0, y: 0}), Replicated)

    const schedule = SystemSchedule.create()

    SystemSchedule.add(schedule, commands.spawnEphemeralCommands)

    const jumpSystem = System.define(
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

    SystemSchedule.add(schedule, jumpSystem)

    SystemSchedule.add(schedule, commands.cleanupEphemeralCommands)
    SystemSchedule.add(schedule, replication.commitPendingMutations)
    SystemSchedule.add(schedule, replication.advanceWorldTick)

    commands.record(world, player, Jump, 0)

    SystemSchedule.run(schedule, world)

    expect(world.tick).toBe(1)
    expect(World.getComponentValue(world, player, Position)?.y).toBe(10)

    const node = SparseMap.get(world.graph.byEntity, player as number)
    const commandOfId = world.componentRegistry.getId(commands.CommandOf)
    expect(
      node?.vec.elements.some(
        (c) => world.componentRegistry.getId(c) === commandOfId,
      ),
    ).toBe(false)
  })
})
