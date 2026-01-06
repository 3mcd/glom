import {describe, expect, test} from "bun:test"
import {define_component} from "./component"
import {define_system} from "./system"
import {add_system, make_system_schedule, run_schedule} from "./system_schedule"
import {add_resource, make_world, type World} from "./world"

describe("system_schedule sorting", () => {
  const A = define_component<number>()
  const B = define_component<number>()
  const schema = [A, B]

  test("writer before reader", () => {
    const order: string[] = []

    const system_read = () => {
      order.push("read")
    }
    define_system(system_read, {
      params: [{read: A}],
    })

    const system_write = () => {
      order.push("write")
    }
    define_system(system_write, {
      params: [{write: A}],
    })

    const schedule = make_system_schedule()
    add_system(schedule, system_read)
    add_system(schedule, system_write)

    const world = make_world({domain_id: 1, schema})
    add_resource(world, A(0))
    run_schedule(schedule, world as World)

    expect(order).toEqual(["write", "read"])
  })

  test("multiple writers in registration order", () => {
    const order: number[] = []

    const w1 = () => {
      order.push(1)
    }
    define_system(w1, {
      params: [{write: A}],
    })

    const w2 = () => {
      order.push(2)
    }
    define_system(w2, {
      params: [{write: A}],
    })

    const schedule = make_system_schedule()
    add_system(schedule, w1)
    add_system(schedule, w2)

    const world = make_world({domain_id: 1, schema})
    add_resource(world, A(0))
    run_schedule(schedule, world as World)

    expect(order).toEqual([1, 2])
  })

  test("complex chain", () => {
    const order: string[] = []
    const s3 = () => {
      order.push("S3")
    }
    define_system(s3, {
      params: [{read: B}],
    })

    const s2 = () => {
      order.push("S2")
    }
    define_system(s2, {
      params: [{read: A}, {write: B}],
    })

    const s1 = () => {
      order.push("S1")
    }
    define_system(s1, {
      params: [{write: A}],
    })

    const schedule = make_system_schedule()

    add_system(schedule, s3)
    add_system(schedule, s2)
    add_system(schedule, s1)

    const world = make_world({domain_id: 1, schema})
    add_resource(world, A(0))
    add_resource(world, B(0))
    run_schedule(schedule, world as World)

    expect(order).toEqual(["S1", "S2", "S3"])
  })

  test("cycle detection", () => {
    const s1 = () => {}
    define_system(s1, {
      params: [{write: A}, {read: B}],
    })

    const s2 = () => {}
    define_system(s2, {
      params: [{write: B}, {read: A}],
    })

    const schedule = make_system_schedule()
    add_system(schedule, s1)
    add_system(schedule, s2)

    const world = make_world({domain_id: 1, schema})
    expect(() => run_schedule(schedule, world as World)).toThrow(
      "Cycle detected in system dependencies",
    )
  })

  test("independent systems use registration order", () => {
    const order: number[] = []

    const s1 = () => {
      order.push(1)
    }
    define_system(s1, {
      params: [{read: A}],
    })

    const s2 = () => {
      order.push(2)
    }
    define_system(s2, {
      params: [{read: B}],
    })

    const schedule = make_system_schedule()
    add_system(schedule, s1)
    add_system(schedule, s2)

    const world = make_world({domain_id: 1, schema})
    add_resource(world, A(0))
    add_resource(world, B(0))
    run_schedule(schedule, world as World)

    expect(order).toEqual([1, 2])
  })
})
