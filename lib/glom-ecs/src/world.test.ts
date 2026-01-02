import { describe, expect, test } from "bun:test"
import { define_component } from "./component"
import { make_entity } from "./entity"
import {
  delete_component_value,
  get_component_store,
  get_component_value,
  make_world,
  set_component_value,
  world_get_or_create_index,
} from "./world"

describe("world_storage", () => {
  const Position = define_component<{ x: number; y: number }>(1)
  const Velocity = define_component<{ x: number; y: number }>(2)

  test("set and get component values", () => {
    const world = make_world(0)
    const entity = make_entity(10, 0)

    set_component_value(world, entity, Position, { x: 1, y: 2 })
    expect(get_component_value(world, entity, Position)).toEqual({ x: 1, y: 2 })

    // Check that it's in the store at the mapped index, not the lo ID
    const index = world_get_or_create_index(world, entity)
    const store = get_component_store(world, Position)
    expect(store[index]).toEqual({ x: 1, y: 2 })
  })

  test("handle hi/lo ID collisions via dense mapping", () => {
    const world = make_world(0)
    const e1 = make_entity(100, 1) // Agent 1, ID 100
    const e2 = make_entity(100, 2) // Agent 2, ID 100

    set_component_value(world, e1, Position, { x: 1, y: 1 })
    set_component_value(world, e2, Position, { x: 2, y: 2 })

    // Both should have unique values despite sharing the same 'lo' bits
    expect(get_component_value(world, e1, Position)).toEqual({ x: 1, y: 1 })
    expect(get_component_value(world, e2, Position)).toEqual({ x: 2, y: 2 })

    const idx1 = world_get_or_create_index(world, e1)
    const idx2 = world_get_or_create_index(world, e2)
    expect(idx1).not.toBe(idx2)
  })

  test("get undefined for missing component", () => {
    const world = make_world(0)
    const entity = make_entity(10, 0)
    expect(get_component_value(world, entity, Position)).toBeUndefined()
  })

  test("remove component value", () => {
    const world = make_world(0)
    const entity = make_entity(10, 0)

    set_component_value(world, entity, Position, { x: 1, y: 2 })
    delete_component_value(world, entity, Position)

    expect(get_component_value(world, entity, Position)).toBeUndefined()
  })

  test("multiple components for same entity", () => {
    const world = make_world(0)
    const entity = make_entity(10, 0)

    set_component_value(world, entity, Position, { x: 1, y: 2 })
    set_component_value(world, entity, Velocity, { x: 5, y: 0 })

    expect(get_component_value(world, entity, Position)).toEqual({ x: 1, y: 2 })
    expect(get_component_value(world, entity, Velocity)).toEqual({ x: 5, y: 0 })
  })
})
