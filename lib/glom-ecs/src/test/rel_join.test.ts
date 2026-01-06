import {describe, expect, test} from "bun:test"
import * as g from "../index"

describe("relation integration", () => {
  const Position = g.defineComponent<{x: number}>()
  const ChildOf = g.defineRelation()
  const Name = g.defineComponent<string>()
  const schema = [Position, ChildOf, Name]

  test("simple rel join", () => {
    const world = g.makeWorld({domainId: 0, schema})
    const parent = g.spawn(world, Position({x: 10}))
    g.spawn(world, Position({x: 1}), ChildOf(parent))

    const results: [{x: number}, {x: number}][] = []
    const system = g.defineSystem(
      (
        query: g.Join<g.All<typeof Position>, g.All<typeof Position>, typeof ChildOf>,
      ) => {
        for (const [pos, parentPos] of query) {
          results.push([pos, parentPos])
        }
      },
      {
        params: [{join: [{all: [Position]}, {all: [Position]}, ChildOf]}],
      },
    )

    const schedule = g.makeSystemSchedule()
    g.addSystem(schedule, system)
    g.runSchedule(schedule, world)

    expect(results.length).toBe(1)
    if (results[0]) {
      expect(results[0][0].x).toBe(1)
      expect(results[0][1].x).toBe(10)
    }
  })

  test("inner join logic (missing component on object)", () => {
    const world = g.makeWorld({domainId: 0, schema})
    const parent = g.spawn(world)
    g.spawn(world, Position({x: 1}), ChildOf(parent))

    const results: unknown[][] = []
    const system = g.defineSystem(
      (
        query: g.Join<g.All<typeof Position>, g.All<typeof Position>, typeof ChildOf>,
      ) => {
        for (const res of query) {
          results.push(res)
        }
      },
      {
        params: [{join: [{all: [Position]}, {all: [Position]}, ChildOf]}],
      },
    )

    const schedule = g.makeSystemSchedule()
    g.addSystem(schedule, system)
    g.runSchedule(schedule, world)

    expect(results.length).toBe(0)
  })

  test("multiple objects for same relationship", () => {
    const world = g.makeWorld({domainId: 0, schema})
    const p1 = g.spawn(world, Position({x: 10}))
    const p2 = g.spawn(world, Position({x: 20}))
    g.spawn(world, Position({x: 1}), ChildOf(p1), ChildOf(p2))

    const results: [{x: number}, {x: number}][] = []
    const system = g.defineSystem(
      (
        query: g.Join<g.All<typeof Position>, g.All<typeof Position>, typeof ChildOf>,
      ) => {
        for (const [pos, parentPos] of query) {
          results.push([pos, parentPos])
        }
      },
      {
        params: [{join: [{all: [Position]}, {all: [Position]}, ChildOf]}],
      },
    )

    const schedule = g.makeSystemSchedule()
    g.addSystem(schedule, system)
    g.runSchedule(schedule, world)

    expect(results.length).toBe(2)
    const xValues = results.map((r) => r[1].x)
    expect(xValues).toContain(10)
    expect(xValues).toContain(20)
  })

  test("nested rel join", () => {
    const world = g.makeWorld({domainId: 0, schema})

    const grandparent = g.spawn(world, Name("Grandparent"))
    const parent = g.spawn(world, Name("Parent"), ChildOf(grandparent))
    g.spawn(world, Name("Child"), ChildOf(parent))

    const results: [string, string][] = []
    const system = g.defineSystem(
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
                join: [
                  {all: [Name]},
                  {all: [Name]},
                  ChildOf,
                ],
              },
              ChildOf,
            ],
          },
        ],
      },
    )

    const schedule = g.makeSystemSchedule()
    g.addSystem(schedule, system)
    g.runSchedule(schedule, world)

    expect(results.length).toBe(1)
    if (results[0]) {
      expect(results[0][0]).toBe("Child")
      expect(results[0][1]).toBe("Grandparent")
    }
  })
})
