import {describe, expect, test} from "bun:test"
import * as Component from "./component"
import * as Entity from "./entity"
import {RESOURCE_ENTITY} from "./entity"
import * as World from "./world"

describe("worldStorage", () => {
  const Position = Component.define<{x: number; y: number}>("Position")
  const Velocity = Component.define<{x: number; y: number}>("Velocity")
  const schema = [Position, Velocity]

  test("set and get component values", () => {
    const world = World.create({domainId: 0})
    const entity = Entity.make(10, 0)

    World.setComponentValue(world, entity, Position, {x: 1, y: 2})
    expect(World.getComponentValue(world, entity, Position)).toEqual({x: 1, y: 2})

    const index = World.getOrCreateIndex(world, entity)
    const store = World.getComponentStore(world, Position)
    expect(store?.[index]).toEqual({x: 1, y: 2})
  })

  test("handle ID collisions across domains via dense mapping", () => {
    const world = World.create({domainId: 0})
    const e1 = Entity.make(100, 1)
    const e2 = Entity.make(100, 2)

    World.setComponentValue(world, e1, Position, {x: 1, y: 1})
    World.setComponentValue(world, e2, Position, {x: 2, y: 2})

    expect(World.getComponentValue(world, e1, Position)).toEqual({x: 1, y: 1})
    expect(World.getComponentValue(world, e2, Position)).toEqual({x: 2, y: 2})

    const idx1 = World.getOrCreateIndex(world, e1)
    const idx2 = World.getOrCreateIndex(world, e2)
    expect(idx1).not.toBe(idx2)
  })

  test("get undefined for missing component", () => {
    const world = World.create({domainId: 0})
    const entity = Entity.make(10, 0)
    expect(World.getComponentValue(world, entity, Position)).toBeUndefined()
  })

  test("remove component value", () => {
    const world = World.create({domainId: 0})
    const entity = Entity.make(10, 0)

    World.setComponentValue(world, entity, Position, {x: 1, y: 2})
    World.deleteComponentValue(world, entity, Position)

    expect(World.getComponentValue(world, entity, Position)).toBeUndefined()
  })

  test("multiple components for same entity", () => {
    const world = World.create({domainId: 0})
    const entity = Entity.make(10, 0)

    World.setComponentValue(world, entity, Position, {x: 1, y: 2})
    World.setComponentValue(world, entity, Velocity, {x: 5, y: 0})

    expect(World.getComponentValue(world, entity, Position)).toEqual({x: 1, y: 2})
    expect(World.getComponentValue(world, entity, Velocity)).toEqual({x: 5, y: 0})
  })

  test("tag components as resources", () => {
    const IsRunning = Component.defineTag("IsRunning")
    const world = World.create({domainId: 0})

    World.addResource(world, IsRunning())
    expect(World.getResource(world, IsRunning)).toBeUndefined()
    const id = world.componentRegistry.getId(IsRunning)
    expect(world.components.resources.has(id)).toBe(true)

    World.deleteComponentValue(world, RESOURCE_ENTITY, IsRunning)
    expect(world.components.resources.has(id)).toBe(false)
  })

  test("regular components as resources", () => {
    const Config = Component.define<{api: string}>("Config")
    const world = World.create({domainId: 0})

    World.addResource(world, Config({api: "localhost"}))
    expect(World.getResource(world, Config)).toEqual({api: "localhost"})

    World.deleteComponentValue(world, RESOURCE_ENTITY, Config)
    expect(World.getResource(world, Config)).toBeUndefined()
  })
})
