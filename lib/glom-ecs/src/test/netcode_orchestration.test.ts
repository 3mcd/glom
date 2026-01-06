import {sparse_map_get} from "../sparse_map"
import {describe, expect, test} from "bun:test"
import {define_component, define_tag} from "../component"
import * as commands from "../command"
import * as replication from "../replication"
import {Replicated} from "../replication_config"
import {
  make_system_schedule,
  add_system,
  run_schedule,
} from "../system_schedule"
import {get_component_value, make_world} from "../world"
import type {World} from "../world"
import {spawn} from "../world_api"
import {All} from "../query/all"
import {Rel, Read} from "../query/term"
import {define_system, type DefinedSystem} from "../system"

describe("netcode orchestration", () => {
  const Position = define_component<{x: number; y: number}>()
  const Jump = define_tag()
  const schema = [Position, Jump]

  test("networked schedule lifecycle", () => {
    const world = make_world({domain_id: 1, schema})
    const player = spawn(world, [Position({x: 0, y: 0}), Replicated])

    const schedule = make_system_schedule()

    add_system(schedule, commands.spawn_ephemeral_commands)

    const jump_system = define_system(
      (
        player_query: All<
          Read<typeof Position>,
          Rel<typeof commands.CommandOf, Read<typeof Jump>>
        >,
      ) => {
        for (const [pos, _jump] of player_query) {

          ;(pos as any).y += 10
        }
      },
      {
        params: [
          {
            all: [{read: Position}, {rel: [commands.CommandOf, {read: Jump}]}],
          } as any,
        ],
        name: "jump_system",
      },
    )

    add_system(schedule, jump_system as any)

    add_system(schedule, commands.cleanup_ephemeral_commands)
    add_system(schedule, replication.commit_pending_mutations)
    add_system(schedule, replication.advance_world_tick)

    commands.record_command(world, player, Jump, 0)

    run_schedule(schedule, world as any)

    expect(world.tick).toBe(1)
    expect(get_component_value(world, player, Position)?.y).toBe(10)

    const node = sparse_map_get(world.entity_graph.by_entity, player as number)
    const command_of_id = world.component_registry.get_id(commands.CommandOf)
    expect(
      node?.vec.elements.some(
        (c) => world.component_registry.get_id(c) === command_of_id,
      ),
    ).toBe(false)
  })
})
