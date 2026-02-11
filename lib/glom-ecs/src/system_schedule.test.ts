import {describe, expect, test} from "bun:test"
import * as Component from "./component"
import * as System from "./system"
import * as SystemSchedule from "./system_schedule"
import * as World from "./world"

describe("systemSchedule sorting", () => {
  const A = Component.define<number>("A")
  const B = Component.define<number>("B")

  test("writer before reader", () => {
    const order: string[] = []

    const systemRead = () => {
      order.push("read")
    }
    System.define(systemRead, {
      params: [{read: A}],
    } as any)

    const systemWrite = () => {
      order.push("write")
    }
    System.define(systemWrite, {
      params: [{write: A}],
    } as any)

    const schedule = SystemSchedule.create()
    SystemSchedule.add(schedule, systemRead)
    SystemSchedule.add(schedule, systemWrite)

    const world = World.create({domainId: 1})
    World.addResource(world, A(0))
    SystemSchedule.run(schedule, world as World.World)

    expect(order).toEqual(["write", "read"])
  })

  test("multiple writers in registration order", () => {
    const order: number[] = []

    const w1 = () => {
      order.push(1)
    }
    System.define(w1, {
      params: [{write: A}],
    } as any)

    const w2 = () => {
      order.push(2)
    }
    System.define(w2, {
      params: [{write: A}],
    } as any)

    const schedule = SystemSchedule.create()
    SystemSchedule.add(schedule, w1)
    SystemSchedule.add(schedule, w2)

    const world = World.create({domainId: 1})
    World.addResource(world, A(0))
    SystemSchedule.run(schedule, world as World.World)

    expect(order).toEqual([1, 2])
  })

  test("complex chain", () => {
    const order: string[] = []
    const s3 = () => {
      order.push("S3")
    }
    System.define(s3, {
      params: [{read: B}],
    } as any)

    const s2 = () => {
      order.push("S2")
    }
    System.define(s2, {
      params: [{read: A}, {write: B}],
    } as any)

    const s1 = () => {
      order.push("S1")
    }
    System.define(s1, {
      params: [{write: A}],
    } as any)

    const schedule = SystemSchedule.create()

    SystemSchedule.add(schedule, s3)
    SystemSchedule.add(schedule, s2)
    SystemSchedule.add(schedule, s1)

    const world = World.create({domainId: 1})
    World.addResource(world, A(0))
    World.addResource(world, B(0))
    SystemSchedule.run(schedule, world as World.World)

    expect(order).toEqual(["S1", "S2", "S3"])
  })

  test("cycle detection", () => {
    const s1 = () => {}
    System.define(s1, {
      params: [{write: A}, {read: B}],
    } as any)

    const s2 = () => {}
    System.define(s2, {
      params: [{write: B}, {read: A}],
    } as any)

    const schedule = SystemSchedule.create()
    SystemSchedule.add(schedule, s1)
    SystemSchedule.add(schedule, s2)

    const world = World.create({domainId: 1})
    expect(() => SystemSchedule.run(schedule, world as World.World)).toThrow(
      "Cycle detected in system dependencies",
    )
  })

  test("independent systems use registration order", () => {
    const order: number[] = []

    const s1 = () => {
      order.push(1)
    }
    System.define(s1, {
      params: [{read: A}],
    } as any)

    const s2 = () => {
      order.push(2)
    }
    System.define(s2, {
      params: [{read: B}],
    } as any)

    const schedule = SystemSchedule.create()
    SystemSchedule.add(schedule, s1)
    SystemSchedule.add(schedule, s2)

    const world = World.create({domainId: 1})
    World.addResource(world, A(0))
    World.addResource(world, B(0))
    SystemSchedule.run(schedule, world as World.World)

    expect(order).toEqual([1, 2])
  })
})
