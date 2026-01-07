import {describe, expect, test} from "bun:test"
import * as g from "../index"

describe("join query", () => {
  const Position = g.defineComponent<{x: number}>()
  const ChildOf = g.defineRelation()
  const Name = g.defineComponent<string>()
  const schema = [Position, ChildOf, Name]

  test("Cartesian product join (no relation)", () => {
    const world = g.makeWorld({domainId: 0, schema})
    g.spawn(world, Position({x: 1}))
    g.spawn(world, Position({x: 2}))
    g.spawn(world, Name("A"))
    g.spawn(world, Name("B"))

    const results: [{x: number}, string][] = []
    const system = g.defineSystem(
      (query: g.Join<g.All<typeof Position>, g.All<typeof Name>>) => {
        for (const [pos, name] of query) {
          results.push([pos, name])
        }
      },
      {
        params: [{join: [{all: [Position]}, {all: [Name]}, undefined]}],
      },
    )

    const schedule = g.makeSystemSchedule()
    g.addSystem(schedule, system)
    g.runSchedule(schedule, world)

    // 2 positions * 2 names = 4 combinations
    expect(results.length).toBe(4)

    const namesForPos1 = results.filter((r) => r[0].x === 1).map((r) => r[1])
    expect(namesForPos1).toContain("A")
    expect(namesForPos1).toContain("B")

    const namesForPos2 = results.filter((r) => r[0].x === 2).map((r) => r[1])
    expect(namesForPos2).toContain("A")
    expect(namesForPos2).toContain("B")
  })

  test("Join with relation", () => {
    const world = g.makeWorld({domainId: 0, schema})
    const parent1 = g.spawn(world, Name("Parent1"))
    const parent2 = g.spawn(world, Name("Parent2"))

    g.spawn(world, Position({x: 1}), ChildOf(parent1))
    g.spawn(world, Position({x: 2}), ChildOf(parent2))

    const results: [{x: number}, string][] = []
    const system = g.defineSystem(
      (
        query: g.Join<
          g.All<typeof Position>,
          g.All<typeof Name>,
          typeof ChildOf
        >,
      ) => {
        for (const [pos, name] of query) {
          results.push([pos, name])
        }
      },
      {
        params: [{join: [{all: [Position]}, {all: [Name]}, ChildOf]}],
      },
    )

    const schedule = g.makeSystemSchedule()
    g.addSystem(schedule, system)
    g.runSchedule(schedule, world)

    expect(results.length).toBe(2)

    const r1 = results.find((r) => r[0].x === 1)
    expect(r1?.[1]).toBe("Parent1")

    const r2 = results.find((r) => r[0].x === 2)
    expect(r2?.[1]).toBe("Parent2")
  })

  test("Reactive Join (partial In)", () => {
    const Tag = g.defineTag()
    const world = g.makeWorld({domainId: 0, schema: [...schema, Tag]})
    const parent1 = g.spawn(world, Name("Parent1"))
    const parent2 = g.spawn(world, Name("Parent2"))

    const results: [{x: number}, string][] = []
    const system = g.defineSystem(
      (
        query: g.Join<
          g.In<typeof Position>,
          g.All<typeof Name>,
          typeof ChildOf
        >,
      ) => {
        for (const [pos, name] of query) {
          results.push([pos, name])
        }
      },
      {
        params: [
          {
            join: [{in: {all: [Position]}}, {all: [Name]}, ChildOf],
          },
        ],
      },
    )

    const schedule = g.makeSystemSchedule()
    g.addSystem(schedule, system)

    // Initial run - nothing happens
    g.runSchedule(schedule, world)
    expect(results.length).toBe(0)

    // Spawn child for parent1
    g.spawn(world, Position({x: 10}), ChildOf(parent1))
    g.flushGraphChanges(world)

    g.runSchedule(schedule, world)
    expect(results.length).toBe(1)
    expect(results[0]).toEqual([{x: 10}, "Parent1"])

    results.length = 0
    // Change parent2 - shouldn't trigger because level 1 is not reactive
    g.addComponent(world, parent2, Tag)
    g.flushGraphChanges(world)
    g.runSchedule(schedule, world)
    expect(results.length).toBe(0)

    // Spawn child for parent2
    g.spawn(world, Position({x: 20}), ChildOf(parent2))
    g.flushGraphChanges(world)
    g.runSchedule(schedule, world)
    expect(results.length).toBe(1)
    expect(results[0]).toEqual([{x: 20}, "Parent2"])
  })

  test("Reactive Join (partial Out)", () => {
    const world = g.makeWorld({domainId: 0, schema})
    const parent1 = g.spawn(world, Name("Parent1"))

    const results: [{x: number}, string][] = []
    const system = g.defineSystem(
      (
        query: g.Join<
          g.Out<typeof Position>,
          g.All<typeof Name>,
          typeof ChildOf
        >,
      ) => {
        for (const [pos, name] of query) {
          results.push([pos, name])
        }
      },
      {
        params: [
          {
            join: [{out: {all: [Position]}}, {all: [Name]}, ChildOf],
          },
        ],
      },
    )

    const schedule = g.makeSystemSchedule()
    g.addSystem(schedule, system)

    const child = g.spawn(world, Position({x: 10}), ChildOf(parent1))
    g.flushGraphChanges(world)
    g.runSchedule(schedule, world) // Clear In monitor if it was one, but this is Out
    results.length = 0

    // Remove position from child
    g.removeComponent(world, child, Position)
    g.flushGraphChanges(world)

    g.runSchedule(schedule, world)
    expect(results.length).toBe(1)
    expect(results[0]).toEqual([{x: 10}, "Parent1"])
  })
})
