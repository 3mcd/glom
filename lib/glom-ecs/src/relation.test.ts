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

describe("Entity Relations Combined", () => {
  const ChildOf = define_relation(100)
  const Name = define_component<string>(101)

  test("all relation features", () => {
    const world = make_world(0)
    const parent = spawn(world, [Name("Parent")])

    // 1. Exact relation query
    let foundChildName = ""
    const system1 = (query: All<Read<typeof Name>, Has<Relationship>>) => {
      for (const [name] of query) {
        foundChildName = name
      }
    }
    const schedule1 = make_system_schedule()
    define_system(system1, {
      params: [{ all: [{ read: Name }, { has: ChildOf(parent) }] }],
    })
    add_system(schedule1, system1)

    spawn(world, [Name("Child"), ChildOf(parent)])
    run_schedule(schedule1, world)

    expect(foundChildName).toBe("Child")

    // 2. Wildcard relation query
    const children: string[] = []
    const system2 = (query: All<Entity, Read<typeof Name>, Has<Relation>>) => {
      for (const [_, name] of query) {
        children.push(name)
      }
    }
    const schedule2 = make_system_schedule()
    define_system(system2, {
      params: [{ all: [ENTITY, { read: Name }, { has: ChildOf }] }],
    })
    add_system(schedule2, system2)
    run_schedule(schedule2, world)
    expect(children).toContain("Child")

    // 3. Cleanup on object destruction
    despawn(world, parent)
    const childrenAfter = [] as string[]
    const system3 = (query: All<Entity, Read<typeof Name>, Has<Relation>>) => {
      for (const [_, name] of query) {
        childrenAfter.push(name)
      }
    }
    const schedule3 = make_system_schedule()
    define_system(system3, {
      params: [{ all: [ENTITY, { read: Name }, { has: ChildOf }] }],
    })
    add_system(schedule3, system3)
    run_schedule(schedule3, world)
    expect(childrenAfter).toEqual([])
  })
})
