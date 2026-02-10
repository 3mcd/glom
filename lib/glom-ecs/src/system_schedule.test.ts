import {describe, expect, test} from "bun:test"
import {defineComponent} from "./component"
import {defineSystem} from "./system"
import {addSystem, makeSystemSchedule, runSchedule} from "./system_schedule"
import {addResource, makeWorld, type World} from "./world"

describe("systemSchedule sorting", () => {
  const A = defineComponent<number>("A")
  const B = defineComponent<number>("B")

  test("writer before reader", () => {
    const order: string[] = []

    const systemRead = () => {
      order.push("read")
    }
    defineSystem(systemRead, {
      params: [{read: A}],
    } as any)

    const systemWrite = () => {
      order.push("write")
    }
    defineSystem(systemWrite, {
      params: [{write: A}],
    } as any)

    const schedule = makeSystemSchedule()
    addSystem(schedule, systemRead)
    addSystem(schedule, systemWrite)

    const world = makeWorld({domainId: 1})
    addResource(world, A(0))
    runSchedule(schedule, world as World)

    expect(order).toEqual(["write", "read"])
  })

  test("multiple writers in registration order", () => {
    const order: number[] = []

    const w1 = () => {
      order.push(1)
    }
    defineSystem(w1, {
      params: [{write: A}],
    } as any)

    const w2 = () => {
      order.push(2)
    }
    defineSystem(w2, {
      params: [{write: A}],
    } as any)

    const schedule = makeSystemSchedule()
    addSystem(schedule, w1)
    addSystem(schedule, w2)

    const world = makeWorld({domainId: 1})
    addResource(world, A(0))
    runSchedule(schedule, world as World)

    expect(order).toEqual([1, 2])
  })

  test("complex chain", () => {
    const order: string[] = []
    const s3 = () => {
      order.push("S3")
    }
    defineSystem(s3, {
      params: [{read: B}],
    } as any)

    const s2 = () => {
      order.push("S2")
    }
    defineSystem(s2, {
      params: [{read: A}, {write: B}],
    } as any)

    const s1 = () => {
      order.push("S1")
    }
    defineSystem(s1, {
      params: [{write: A}],
    } as any)

    const schedule = makeSystemSchedule()

    addSystem(schedule, s3)
    addSystem(schedule, s2)
    addSystem(schedule, s1)

    const world = makeWorld({domainId: 1})
    addResource(world, A(0))
    addResource(world, B(0))
    runSchedule(schedule, world as World)

    expect(order).toEqual(["S1", "S2", "S3"])
  })

  test("cycle detection", () => {
    const s1 = () => {}
    defineSystem(s1, {
      params: [{write: A}, {read: B}],
    } as any)

    const s2 = () => {}
    defineSystem(s2, {
      params: [{write: B}, {read: A}],
    } as any)

    const schedule = makeSystemSchedule()
    addSystem(schedule, s1)
    addSystem(schedule, s2)

    const world = makeWorld({domainId: 1})
    expect(() => runSchedule(schedule, world as World)).toThrow(
      "Cycle detected in system dependencies",
    )
  })

  test("independent systems use registration order", () => {
    const order: number[] = []

    const s1 = () => {
      order.push(1)
    }
    defineSystem(s1, {
      params: [{read: A}],
    } as any)

    const s2 = () => {
      order.push(2)
    }
    defineSystem(s2, {
      params: [{read: B}],
    } as any)

    const schedule = makeSystemSchedule()
    addSystem(schedule, s1)
    addSystem(schedule, s2)

    const world = makeWorld({domainId: 1})
    addResource(world, A(0))
    addResource(world, B(0))
    runSchedule(schedule, world as World)

    expect(order).toEqual([1, 2])
  })
})
