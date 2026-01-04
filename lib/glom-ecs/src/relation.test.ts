import { describe, expect, test } from "bun:test"
import {
  All,
  define_component,
  define_relation,
  despawn,
  Entity,
  Has,
  make_world,
  Read,
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
  const ChildOf = define_relation()
  const Name = define_component<string>()

  test("all relation features", () => {
    const schema = [Name, ChildOf]
    const world = make_world(0, schema)
    const parent = spawn(world, [Name("Parent")])

    // 1. Exact relation query
    let child_name = ""
    const system1 = define_system(
      (query: All<Read<typeof Name>, Has<Relationship>>) => {
        for (const [name] of query) {
          child_name = name
        }
      },
      {
        params: [All(Read(Name), Has(ChildOf(parent)))],
      },
    )
    const schedule1 = make_system_schedule()
    add_system(schedule1, system1)

    spawn(world, [Name("Child"), ChildOf(parent)])
    run_schedule(schedule1, world)

    expect(child_name).toBe("Child")

    // 2. Wildcard relation query
    const children: string[] = []
    const system2 = define_system(
      (query: All<Entity, Read<typeof Name>, Has<Relation>>) => {
        for (const [_, name] of query) {
          children.push(name)
        }
      },
      {
        params: [All(Entity, Read(Name), Has(ChildOf))],
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
        params: [All(Entity, Read(Name), Has(ChildOf))],
      },
    )
    const schedule3 = make_system_schedule()
    add_system(schedule3, system3)
    run_schedule(schedule3, world)
    expect(childrenAfter).toEqual([])
  })
})
