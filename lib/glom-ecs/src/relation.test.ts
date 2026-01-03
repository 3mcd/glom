import { describe, expect, test } from "bun:test"
import {
  type All,
  define_component,
  define_relation,
  despawn,
  ENTITY,
  type Entity,
  type Has,
  make_world,
  type Read,
  type Relation,
  type Relationship,
  spawn,
} from "./index"
import { define_system } from "./system"
import {
  add_system,
  make_system_schedule,
  run_schedule,
} from "./system_schedule"

describe("relation", () => {
  const ChildOf = define_relation(100)
  const Name = define_component<string>(101)

  test("all relation features", () => {
    const world = make_world(0)
    const parent = spawn(world, [Name("Parent")])

    // 1. Exact relation query
    let foundChildName = ""
    const system1 = define_system(
      (query: All<Read<typeof Name>, Has<Relationship>>) => {
        for (const [name] of query) {
          foundChildName = name
        }
      },
      {
        params: [{ all: [{ read: Name }, { has: ChildOf(parent) }] }],
      },
    )
    const schedule1 = make_system_schedule()
    add_system(schedule1, system1)

    spawn(world, [Name("Child"), ChildOf(parent)])
    run_schedule(schedule1, world)

    expect(foundChildName).toBe("Child")

    // 2. Wildcard relation query
    const children: string[] = []
    const system2 = define_system(
      (query: All<Entity, Read<typeof Name>, Has<Relation>>) => {
        for (const [_, name] of query) {
          children.push(name)
        }
      },
      {
        params: [{ all: [ENTITY, { read: Name }, { has: ChildOf }] }],
      },
    )
    const schedule2 = make_system_schedule()
    add_system(schedule2, system2)
    run_schedule(schedule2, world)
    expect(children).toContain("Child")

    // 3. Cleanup on object destruction
    despawn(world, parent)
    const childrenAfter = [] as string[]
    const system3 = define_system(
      (query: All<Entity, Read<typeof Name>, Has<Relation>>) => {
        for (const [_, name] of query) {
          childrenAfter.push(name)
        }
      },
      {
        params: [{ all: [ENTITY, { read: Name }, { has: ChildOf }] }],
      },
    )
    const schedule3 = make_system_schedule()
    add_system(schedule3, system3)
    run_schedule(schedule3, world)
    expect(childrenAfter).toEqual([])
  })
})
