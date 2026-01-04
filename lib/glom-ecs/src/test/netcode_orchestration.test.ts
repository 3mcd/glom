import { sparse_map_get } from "../sparse_map"
import { describe, expect, test } from "bun:test"
import { define_component, define_tag } from "../component"
import { record_command, CommandOf } from "../command"
import { GlomNetwork } from "../netcode"
import { Replicated } from "../replication"
import { make_system_schedule, add_system, run_schedule } from "../system_schedule"
import { get_component_value, make_world } from "../world"
import { spawn } from "../world_api"
import { All } from "../query/all"
import { Rel, Read } from "../query/term"

describe("netcode orchestration", () => {
  const Position = define_component<{ x: number; y: number }>()
  const Jump = define_tag()
  const schema = [Position, Jump]

  test("networked schedule lifecycle", () => {
    const world = make_world(1, schema)
    const player = spawn(world, [Position({ x: 0, y: 0 }), Replicated])
    
    // Setup schedule
    const schedule = make_system_schedule()
    
    // 1. Setup Networking
    add_system(schedule, GlomNetwork.commands.spawn_ephemeral_commands)
    
    // 2. User Logic (System using Relational Command Query)
    const jump_system = define_system((
      // @ts-expect-error - queries not fully typed in test yet
      player_query: All<Read<Position>, Rel<CommandOf, Read<Jump>>>
    ) => {
      // @ts-ignore
      for (const [pos, jump] of player_query) {
        // We found a jump command for this player!
        pos.y += 10
      }
    }, { params: [All(Read(Position), Rel(CommandOf, Read(Jump)))] })
    
    add_system(schedule, jump_system as unknown as DefinedSystem<[All<[Read<{ x: number; y: number }>, Rel<typeof CommandOf, Read<void>>]>]>)
    
    // 3. Teardown & Sync
    add_system(schedule, GlomNetwork.commands.cleanup_ephemeral_commands)
    add_system(schedule, GlomNetwork.replicate.commit_pending_mutations)
    add_system(schedule, GlomNetwork.replicate.advance_world_tick)

    // Record a command for Tick 0
    record_command(world, player, Jump, 0)
    
    // Run Tick 0
    run_schedule(schedule, world as unknown as g.World)
    
    expect(world.tick).toBe(1)
    expect(get_component_value(world, player, Position)?.y).toBe(10)
    
    // Verify cleanup: player should no longer have CommandOf
    const node = sparse_map_get(world.entity_graph.by_entity, player as number)
    const command_of_id = world.component_registry.get_id(CommandOf)
    expect(node?.vec.elements.some(c => world.component_registry.get_id(c) === command_of_id)).toBe(false)
  })
})

// Helper to define system since it's not exported globally
import { define_system } from "../system"

