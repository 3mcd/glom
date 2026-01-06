import {describe, expect, test} from "bun:test"
import {
  All,
  defineComponent,
  defineRelation,
  despawn,
  Entity,
  Has,
  makeWorld,
  Read,
  type Relation,
  type Relationship,
  spawn,
} from "./index"
import {defineSystem} from "./system"
import {addSystem, makeSystemSchedule, runSchedule} from "./system_schedule"

describe("relation", () => {
  const ChildOf = defineRelation()
  const Name = defineComponent<string>()

  test("all relation features", () => {
    const schema = [Name, ChildOf]
    const world = makeWorld({domainId: 0, schema})
    const parent = spawn(world, [Name("Parent")])

    let childName = ""
    const system1 = defineSystem(
      (query: All<Read<typeof Name>, Has<Relationship>>) => {
        for (const [name] of query) {
          childName = name
        }
      },
      {
        params: [All(Read(Name), Has(ChildOf(parent)))],
      },
    )
    const schedule1 = makeSystemSchedule()
    addSystem(schedule1, system1)

    spawn(world, [Name("Child"), ChildOf(parent)])
    runSchedule(schedule1, world)

    expect(childName).toBe("Child")

    const children: string[] = []
    const system2 = defineSystem(
      (query: All<Entity, Read<typeof Name>, Has<Relation>>) => {
        for (const [_, name] of query) {
          children.push(name)
        }
      },
      {
        params: [All(Entity, Read(Name), Has(ChildOf))],
      },
    )
    const schedule2 = makeSystemSchedule()
    addSystem(schedule2, system2)
    runSchedule(schedule2, world)
    expect(children).toContain("Child")

    despawn(world, parent)
    const childrenAfter = [] as string[]
    const system3 = defineSystem(
      (query: All<Entity, Read<typeof Name>, Has<Relation>>) => {
        for (const [_, name] of query) {
          childrenAfter.push(name)
        }
      },
      {
        params: [All(Entity, Read(Name), Has(ChildOf))],
      },
    )
    const schedule3 = makeSystemSchedule()
    addSystem(schedule3, system3)
    runSchedule(schedule3, world)
    expect(childrenAfter).toEqual([])
  })
})
