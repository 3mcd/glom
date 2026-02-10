import {describe, expect, test} from "bun:test"
import {defineComponent, defineTag} from "./component"
import {makeEntity, RESOURCE_ENTITY} from "./entity"
import {
  addResource,
  deleteComponentValue,
  getComponentStore,
  getComponentValue,
  getResource,
  makeWorld,
  setComponentValue,
  getOrCreateIndex,
} from "./world"

describe("worldStorage", () => {
  const Position = defineComponent<{x: number; y: number}>("Position")
  const Velocity = defineComponent<{x: number; y: number}>("Velocity")
  const schema = [Position, Velocity]

  test("set and get component values", () => {
    const world = makeWorld({domainId: 0})
    const entity = makeEntity(10, 0)

    setComponentValue(world, entity, Position, {x: 1, y: 2})
    expect(getComponentValue(world, entity, Position)).toEqual({x: 1, y: 2})

    const index = getOrCreateIndex(world, entity)
    const store = getComponentStore(world, Position)
    expect(store?.[index]).toEqual({x: 1, y: 2})
  })

  test("handle ID collisions across domains via dense mapping", () => {
    const world = makeWorld({domainId: 0})
    const e1 = makeEntity(100, 1)
    const e2 = makeEntity(100, 2)

    setComponentValue(world, e1, Position, {x: 1, y: 1})
    setComponentValue(world, e2, Position, {x: 2, y: 2})

    expect(getComponentValue(world, e1, Position)).toEqual({x: 1, y: 1})
    expect(getComponentValue(world, e2, Position)).toEqual({x: 2, y: 2})

    const idx1 = getOrCreateIndex(world, e1)
    const idx2 = getOrCreateIndex(world, e2)
    expect(idx1).not.toBe(idx2)
  })

  test("get undefined for missing component", () => {
    const world = makeWorld({domainId: 0})
    const entity = makeEntity(10, 0)
    expect(getComponentValue(world, entity, Position)).toBeUndefined()
  })

  test("remove component value", () => {
    const world = makeWorld({domainId: 0})
    const entity = makeEntity(10, 0)

    setComponentValue(world, entity, Position, {x: 1, y: 2})
    deleteComponentValue(world, entity, Position)

    expect(getComponentValue(world, entity, Position)).toBeUndefined()
  })

  test("multiple components for same entity", () => {
    const world = makeWorld({domainId: 0})
    const entity = makeEntity(10, 0)

    setComponentValue(world, entity, Position, {x: 1, y: 2})
    setComponentValue(world, entity, Velocity, {x: 5, y: 0})

    expect(getComponentValue(world, entity, Position)).toEqual({x: 1, y: 2})
    expect(getComponentValue(world, entity, Velocity)).toEqual({x: 5, y: 0})
  })

  test("tag components as resources", () => {
    const IsRunning = defineTag("IsRunning")
    const world = makeWorld({domainId: 0})

    addResource(world, IsRunning())
    expect(getResource(world, IsRunning)).toBeUndefined()
    const id = world.componentRegistry.getId(IsRunning)
    expect(world.components.resourceTags.has(id)).toBe(true)

    deleteComponentValue(world, RESOURCE_ENTITY, IsRunning)
    expect(world.components.resourceTags.has(id)).toBe(false)
  })

  test("regular components as resources", () => {
    const Config = defineComponent<{api: string}>("Config")
    const world = makeWorld({domainId: 0})

    addResource(world, Config({api: "localhost"}))
    expect(getResource(world, Config)).toEqual({api: "localhost"})

    deleteComponentValue(world, RESOURCE_ENTITY, Config)
    expect(getResource(world, Config)).toBeUndefined()
  })
})
