import {describe, expect, test} from "bun:test"
import * as g from "./index"

describe("relation integration", () => {
  const Position = g.define_component<{x: number}>()
  const ChildOf = g.define_relation()
  const schema = [Position, ChildOf]

  test("simple rel join", () => {
    const world = g.make_world(0, schema)
    const parent = g.spawn(world, [Position({x: 10})])
    const child = g.spawn(world, [Position({x: 1}), ChildOf(parent)])

    const results: [{x: number}, {x: number}][] = []
    const system = (
      query: g.All<
        g.Read<typeof Position>,
        g.Rel<typeof ChildOf, typeof Position>
      >,
    ) => {
      for (const [pos, parent_pos] of query) {
        results.push([pos, parent_pos])
      }
    }

    g.define_system(system, {
      params: [{all: [{read: Position}, {rel: [ChildOf, {read: Position}]}]}],
    })

    const schedule = g.make_system_schedule()
    g.add_system(schedule, system)
    g.run_schedule(schedule, world)

    expect(results.length).toBe(1)
    expect(results[0]![0].x).toBe(1)
    expect(results[0]![1].x).toBe(10)
  })

  test("inner join logic (missing component on object)", () => {
    const world = g.make_world(0, schema)
    const parent = g.spawn(world, []) // Parent has NO Position
    g.spawn(world, [Position({x: 1}), ChildOf(parent)]) // child

    const results: unknown[][] = []
    const system = (
      query: g.All<
        g.Read<typeof Position>,
        g.Rel<typeof ChildOf, typeof Position>
      >,
    ) => {
      for (const res of query) {
        results.push(res)
      }
    }

    g.define_system(system, {
      params: [{all: [{read: Position}, {rel: [ChildOf, {read: Position}]}]}],
    })

    const schedule = g.make_system_schedule()
    g.add_system(schedule, system)
    g.run_schedule(schedule, world)

    expect(results.length).toBe(0) // Should be skipped because parent has no Position
  })

  test("multiple objects for same relationship", () => {
    const world = g.make_world(0, schema)
    const p1 = g.spawn(world, [Position({x: 10})])
    const p2 = g.spawn(world, [Position({x: 20})])
    g.spawn(world, [Position({x: 1}), ChildOf(p1), ChildOf(p2)]) // child

    const results: [{x: number}, {x: number}][] = []
    const system = (
      query: g.All<
        g.Read<typeof Position>,
        g.Rel<typeof ChildOf, typeof Position>
      >,
    ) => {
      for (const [pos, parent_pos] of query) {
        results.push([pos, parent_pos])
      }
    }

    g.define_system(system, {
      params: [{all: [{read: Position}, {rel: [ChildOf, {read: Position}]}]}],
    })

    const schedule = g.make_system_schedule()
    g.add_system(schedule, system)
    g.run_schedule(schedule, world)

    expect(results.length).toBe(2)
    const xValues = results.map((r) => r[1].x)
    expect(xValues).toContain(10)
    expect(xValues).toContain(20)
  })

  test("nested rel join", () => {
    const Name = g.define_component<string>()
    const world = g.make_world(0, [Position, ChildOf, Name])

    const grandparent = g.spawn(world, [Name("Grandparent")])
    const parent = g.spawn(world, [Name("Parent"), ChildOf(grandparent)])
    const child = g.spawn(world, [Name("Child"), ChildOf(parent)])

    const results: [string, string][] = []
    const system = (
      query: g.All<
        g.Read<typeof Name>,
        g.Rel<typeof ChildOf, g.Rel<typeof ChildOf, typeof Name>>
      >,
    ) => {
      for (const [name, grandparent_name] of query) {
        results.push([name, grandparent_name])
      }
    }

    g.define_system(system, {
      params: [
        {
          all: [{read: Name}, {rel: [ChildOf, {rel: [ChildOf, {read: Name}]}]}],
        },
      ],
    })

    const schedule = g.make_system_schedule()
    g.add_system(schedule, system)
    g.run_schedule(schedule, world)

    expect(results.length).toBe(1)
    expect(results[0]![0]).toBe("Child")
    expect(results[0]![1]).toBe("Grandparent")
  })
})
