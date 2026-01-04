import { describe, expect, test } from "bun:test"
import * as g from "../index"

describe("relation integration", () => {
  const Position = g.define_component<{ x: number }>()
  const ChildOf = g.define_relation()
  const Name = g.define_component<string>()
  const schema = [Position, ChildOf, Name]

  test("simple rel join", () => {
    const world = g.make_world(0, schema)
    const parent = g.spawn(world, [Position({ x: 10 })])
    g.spawn(world, [Position({ x: 1 }), ChildOf(parent)])

    const results: [{ x: number }, { x: number }][] = []
    const system = g.define_system(
      (
        query: g.All<
          g.Read<typeof Position>,
          g.Rel<typeof ChildOf, typeof Position>
        >,
      ) => {
        for (const [pos, parent_pos] of query) {
          results.push([pos, parent_pos])
        }
      },
      {
        params: [
          { all: [{ read: Position }, { rel: [ChildOf, { read: Position }] }] },
        ],
      },
    )

    const schedule = g.make_system_schedule()
    g.add_system(schedule, system)
    g.run_schedule(schedule, world)

    expect(results.length).toBe(1)
    if (results[0]) {
      expect(results[0][0].x).toBe(1)
      expect(results[0][1].x).toBe(10)
    }
  })

  test("inner join logic (missing component on object)", () => {
    const world = g.make_world(0, schema)
    const parent = g.spawn(world, []) // Parent has NO Position
    g.spawn(world, [Position({ x: 1 }), ChildOf(parent)]) // child

    const results: unknown[][] = []
    const system = g.define_system(
      (
        query: g.All<
          g.Read<typeof Position>,
          g.Rel<typeof ChildOf, typeof Position>
        >,
      ) => {
        for (const res of query) {
          results.push(res)
        }
      },
      {
        params: [
          { all: [{ read: Position }, { rel: [ChildOf, { read: Position }] }] },
        ],
      },
    )

    const schedule = g.make_system_schedule()
    g.add_system(schedule, system)
    g.run_schedule(schedule, world)

    expect(results.length).toBe(0) // Should be skipped because parent has no Position
  })

  test("multiple objects for same relationship", () => {
    const world = g.make_world(0, schema)
    const p1 = g.spawn(world, [Position({ x: 10 })])
    const p2 = g.spawn(world, [Position({ x: 20 })])
    g.spawn(world, [Position({ x: 1 }), ChildOf(p1), ChildOf(p2)]) // child

    const results: [{ x: number }, { x: number }][] = []
    const system = g.define_system(
      (
        query: g.All<
          g.Read<typeof Position>,
          g.Rel<typeof ChildOf, typeof Position>
        >,
      ) => {
        for (const [pos, parent_pos] of query) {
          results.push([pos, parent_pos])
        }
      },
      {
        params: [
          { all: [{ read: Position }, { rel: [ChildOf, { read: Position }] }] },
        ],
      },
    )

    const schedule = g.make_system_schedule()
    g.add_system(schedule, system)
    g.run_schedule(schedule, world)

    expect(results.length).toBe(2)
    const xValues = results.map((r) => r[1].x)
    expect(xValues).toContain(10)
    expect(xValues).toContain(20)
  })

  test("nested rel join", () => {
    const world = g.make_world(0, schema)

    const grandparent = g.spawn(world, [Name("Grandparent")])
    const parent = g.spawn(world, [Name("Parent"), ChildOf(grandparent)])
    g.spawn(world, [Name("Child"), ChildOf(parent)])

    const results: [string, string][] = []
    const system = g.define_system(
      (
        query: g.All<
          g.Read<typeof Name>,
          g.Rel<typeof ChildOf, g.Rel<typeof ChildOf, typeof Name>>
        >,
      ) => {
        for (const [name, grandparent_name] of query) {
          results.push([name, grandparent_name])
        }
      },
      {
        params: [
          {
            all: [
              { read: Name },
              { rel: [ChildOf, { rel: [ChildOf, { read: Name }] }] },
            ],
          },
        ],
      },
    )

    const schedule = g.make_system_schedule()
    g.add_system(schedule, system)
    g.run_schedule(schedule, world)

    expect(results.length).toBe(1)
    if (results[0]) {
      expect(results[0][0]).toBe("Child")
      expect(results[0][1]).toBe("Grandparent")
    }
  })
})
