import {describe, expect, mock, test} from "bun:test"
import {defineComponent, defineTag} from "./component"
import {entityGraphGetEntityNode} from "./entity_graph"
import {
  clearSystemExecutorMonitors,
  makeSystemExecutor,
  runSystemExecutor,
  setupSystemExecutor,
  teardownSystemExecutor,
} from "./system_executor"
import {addResource, getComponentValue, makeWorld} from "./world"
import {spawn} from "./world_api"

describe("system_executor", () => {
  const Position = defineComponent<{x: number; y: number}>("Position")
  const IsStatic = defineTag("IsStatic")
  const schema = [Position, IsStatic]

  test("setup and teardown with All, In, and Out", () => {
    const world = makeWorld({domainId: 0})
    const system = () => {}
    const desc = {
      params: [
        {all: [{write: Position}]},
        {in: {all: [{read: Position}]}},
        {out: {all: [{read: Position}]}},
      ],
    }
    const exec = makeSystemExecutor(system as any, desc as any)

    setupSystemExecutor(exec, world)
    expect(exec.args.length).toBe(3)
    expect(exec.args[0]).toBeDefined() // All
    expect(exec.args[1]).toBeDefined() // In
    expect(exec.args[2]).toBeDefined() // Out

    teardownSystemExecutor(exec)
  })

  test("clearSystemExecutorMonitors", () => {
    const world = makeWorld({domainId: 0})
    const system = () => {}
    const desc = {
      params: [{in: {all: [{read: Position}]}}],
    }
    const exec = makeSystemExecutor(system as any, desc as any)
    setupSystemExecutor(exec, world)

    const monitor = exec.args[0] as any
    spawn(world, Position({x: 1, y: 1}))
    // The monitor should have something in its 'added' set now
    // (Actual logic for monitors is tested elsewhere, we just want to see clear() called)

    const clearSpy = mock(() => {})
    monitor.clear = clearSpy

    clearSystemExecutorMonitors(exec)
    expect(clearSpy).toHaveBeenCalled()
  })

  test("setup with Has, Not, Spawn, Despawn, Add, and Remove", () => {
    const world = makeWorld({domainId: 0})
    addResource(world, {component: Position, value: {x: 1, y: 1}}) // Resource Position exists

    const desc = {
      params: [
        {has: Position},
        {not: IsStatic},
        {spawn: true},
        {despawn: true},
        {add: Position},
        {remove: Position},
      ],
    }

    const entity = spawn(world)

    const systemToRun = (
      _has: any,
      _not: any,
      spawnFn: any,
      despawnFn: any,
      addFn: any,
      removeFn: any,
    ) => {
      // Test variadic spawn
      const e = spawnFn(IsStatic, Position({x: 5, y: 5}))
      const nodeE = entityGraphGetEntityNode(world.graph, e)
      expect(
        nodeE?.vec.sparse.has(world.componentRegistry.getId(IsStatic)),
      ).toBe(true)
      expect(
        nodeE?.vec.sparse.has(world.componentRegistry.getId(Position)),
      ).toBe(true)
      expect(getComponentValue(world, e, Position)?.x).toBe(5)

      addFn(entity, {x: 10, y: 10})
      expect(getComponentValue(world, entity, Position)?.x).toBe(10)

      removeFn(entity)
      expect(getComponentValue(world, entity, Position)).toBeUndefined()

      despawnFn(e)
    }

    const exec2 = makeSystemExecutor(systemToRun as any, desc as any)
    setupSystemExecutor(exec2, world)
    runSystemExecutor(exec2)
  })

  test("Add descriptor with Tag", () => {
    const world = makeWorld({domainId: 0})
    const entity = spawn(world)

    const desc = {
      params: [{add: IsStatic}],
    }
    const system = (add: any) => {
      add(entity)
    }

    const exec = makeSystemExecutor(system as any, desc as any)
    setupSystemExecutor(exec, world)
    runSystemExecutor(exec)

    const node = entityGraphGetEntityNode(world.graph, entity)
    expect(node?.vec.sparse.has(world.componentRegistry.getId(IsStatic))).toBe(
      true,
    )
  })

  test("Has/Not throws if resource condition not met", () => {
    const world = makeWorld({domainId: 0})
    // Position does NOT exist as a resource

    const descHas = {params: [{has: Position}]}
    const execHas = makeSystemExecutor((() => {}) as any, descHas as any)
    expect(() => setupSystemExecutor(execHas, world)).toThrow(/not found/)

    addResource(world, {component: IsStatic, value: undefined})
    const descNot = {params: [{not: IsStatic}]}
    const execNot = makeSystemExecutor((() => {}) as any, descNot as any)
    expect(() => setupSystemExecutor(execNot, world)).toThrow(
      /should not exist/,
    )
  })
})
