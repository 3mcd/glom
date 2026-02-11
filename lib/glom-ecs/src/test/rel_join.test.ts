import {describe, expect, test} from "bun:test"
import * as g from "../index"

describe("relation integration", () => {
  const Position = g.Component.define<{x: number}>("Position")
  const ChildOf = g.Relation.define("ChildOf")
  const Name = g.Component.define<string>("Name")
  const schema = [Position, ChildOf, Name]

  test("simple rel join", () => {
    const world = g.World.create({domainId: 0})
    const parent = g.World.spawn(world, Position({x: 10}))
    g.World.spawn(world, Position({x: 1}), ChildOf(parent))

    const results: [{x: number}, {x: number}][] = []
    const system = g.System.define(
      (
        query: g.Join<
          g.All<typeof Position>,
          g.All<typeof Position>,
          typeof ChildOf
        >,
      ) => {
        for (const [pos, parentPos] of query) {
          results.push([pos, parentPos])
        }
      },
      {
        params: [{join: [{all: [Position]}, {all: [Position]}, ChildOf]}],
      },
    )

    const schedule = g.SystemSchedule.create()
    g.SystemSchedule.add(schedule, system)
    g.SystemSchedule.run(schedule, world)

    expect(results.length).toBe(1)
    if (results[0]) {
      expect(results[0][0].x).toBe(1)
      expect(results[0][1].x).toBe(10)
    }
  })

  test("inner join logic (missing component on object)", () => {
    const world = g.World.create({domainId: 0})
    const parent = g.World.spawn(world)
    g.World.spawn(world, Position({x: 1}), ChildOf(parent))

    const results: unknown[][] = []
    const system = g.System.define(
      (
        query: g.Join<
          g.All<typeof Position>,
          g.All<typeof Position>,
          typeof ChildOf
        >,
      ) => {
        for (const res of query) {
          results.push(res)
        }
      },
      {
        params: [{join: [{all: [Position]}, {all: [Position]}, ChildOf]}],
      },
    )

    const schedule = g.SystemSchedule.create()
    g.SystemSchedule.add(schedule, system)
    g.SystemSchedule.run(schedule, world)

    expect(results.length).toBe(0)
  })

  test("multiple objects for same relationship", () => {
    const world = g.World.create({domainId: 0})
    const p1 = g.World.spawn(world, Position({x: 10}))
    const p2 = g.World.spawn(world, Position({x: 20}))
    g.World.spawn(world, Position({x: 1}), ChildOf(p1), ChildOf(p2))

    const results: [{x: number}, {x: number}][] = []
    const system = g.System.define(
      (
        query: g.Join<
          g.All<typeof Position>,
          g.All<typeof Position>,
          typeof ChildOf
        >,
      ) => {
        for (const [pos, parentPos] of query) {
          results.push([pos, parentPos])
        }
      },
      {
        params: [{join: [{all: [Position]}, {all: [Position]}, ChildOf]}],
      },
    )

    const schedule = g.SystemSchedule.create()
    g.SystemSchedule.add(schedule, system)
    g.SystemSchedule.run(schedule, world)

    expect(results.length).toBe(2)
    const xValues = results.map((r) => r[1].x)
    expect(xValues).toContain(10)
    expect(xValues).toContain(20)
  })

  test("nested rel join", () => {
    const world = g.World.create({domainId: 0})

    const grandparent = g.World.spawn(world, Name("Grandparent"))
    const parent = g.World.spawn(world, Name("Parent"), ChildOf(grandparent))
    g.World.spawn(world, Name("Child"), ChildOf(parent))

    const results: [string, string][] = []
    const system = g.System.define(
      (
        query: g.Join<
          g.All<typeof Name>,
          g.Join<g.All<typeof Name>, g.All<typeof Name>, typeof ChildOf>,
          typeof ChildOf
        >,
      ) => {
        for (const [name, _parentName, grandparentName] of query) {
          results.push([name, grandparentName])
        }
      },
      {
        params: [
          {
            join: [
              {all: [Name]},
              {
                join: [{all: [Name]}, {all: [Name]}, ChildOf],
              },
              ChildOf,
            ],
          },
        ],
      },
    )

    const schedule = g.SystemSchedule.create()
    g.SystemSchedule.add(schedule, system)
    g.SystemSchedule.run(schedule, world)

    expect(results.length).toBe(1)
    if (results[0]) {
      expect(results[0][0]).toBe("Child")
      expect(results[0][1]).toBe("Grandparent")
    }
  })
})
