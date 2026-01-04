import {describe, expect, test} from "bun:test"
import {define_component, define_tag} from "./component"
import {make_entity, RESOURCE_ENTITY} from "./entity"
import {
  add_resource,
  delete_component_value,
  get_component_store,
  get_component_value,
  get_resource,
  make_world,
  set_component_value,
  world_get_or_create_index,
} from "./world"

describe("world_storage", () => {
  const Position = define_component<{x: number; y: number}>()
  const Velocity = define_component<{x: number; y: number}>()
  const schema = [Position, Velocity]

  test("set and get component values", () => {
    const world = make_world(0, schema)
    const entity = make_entity(10, 0)

    set_component_value(world, entity, Position, {x: 1, y: 2})
    expect(get_component_value(world, entity, Position)).toEqual({x: 1, y: 2})

    const index = world_get_or_create_index(world, entity)
    const store = get_component_store(world, Position)
    expect(store![index]).toEqual({x: 1, y: 2})
  })

  test("handle ID collisions across domains via dense mapping", () => {
    const world = make_world(0, schema)
    const e1 = make_entity(100, 1)
    const e2 = make_entity(100, 2)

    set_component_value(world, e1, Position, {x: 1, y: 1})
    set_component_value(world, e2, Position, {x: 2, y: 2})

    expect(get_component_value(world, e1, Position)).toEqual({x: 1, y: 1})
    expect(get_component_value(world, e2, Position)).toEqual({x: 2, y: 2})

    const idx1 = world_get_or_create_index(world, e1)
    const idx2 = world_get_or_create_index(world, e2)
    expect(idx1).not.toBe(idx2)
  })

  test("get undefined for missing component", () => {
    const world = make_world(0, schema)
    const entity = make_entity(10, 0)
    expect(get_component_value(world, entity, Position)).toBeUndefined()
  })

  test("remove component value", () => {
    const world = make_world(0, schema)
    const entity = make_entity(10, 0)

    set_component_value(world, entity, Position, {x: 1, y: 2})
    delete_component_value(world, entity, Position)

    expect(get_component_value(world, entity, Position)).toBeUndefined()
  })

  test("multiple components for same entity", () => {
    const world = make_world(0, schema)
    const entity = make_entity(10, 0)

    set_component_value(world, entity, Position, {x: 1, y: 2})
    set_component_value(world, entity, Velocity, {x: 5, y: 0})

    expect(get_component_value(world, entity, Position)).toEqual({x: 1, y: 2})
    expect(get_component_value(world, entity, Velocity)).toEqual({x: 5, y: 0})
  })

  test("tag components as resources", () => {
    const IsRunning = define_tag()
    const world = make_world(0, [IsRunning])

    add_resource(world, IsRunning())
    expect(get_resource(world, IsRunning)).toBeUndefined()
    const id = world.component_registry.get_id(IsRunning)
    expect(world.components.resource_tags.has(id)).toBe(true)

    delete_component_value(world, RESOURCE_ENTITY, IsRunning)
    expect(world.components.resource_tags.has(id)).toBe(false)
  })

  test("regular components as resources", () => {
    const Config = define_component<{api: string}>()
    const world = make_world(0, [Config])

    add_resource(world, Config({api: "localhost"}))
    expect(get_resource(world, Config)).toEqual({api: "localhost"})

    delete_component_value(world, RESOURCE_ENTITY, Config)
    expect(get_resource(world, Config)).toBeUndefined()
  })
})
