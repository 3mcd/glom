import {describe, expect, test} from "bun:test"
import {defineComponent} from "./component"
import {defineRelation} from "./relation"
import {
  HistoryBuffer,
  captureSnapshot,
  makeHistoryBuffer,
  pushSnapshot,
  rollbackToSnapshot,
  rollbackToTick,
} from "./history"
import {resimulateWithTransactions} from "./reconciliation"
import {InputBuffer} from "./replication_config"
import {getComponentValue, getResource, makeWorld} from "./world"
import {sparseMapGet} from "./sparse_map"
import {
  addComponent,
  addResource,
  advanceTick,
  commitTransaction,
  despawn,
  spawn,
} from "./world_api"

describe("history", () => {
  const Position = defineComponent<{x: number; y: number}>()

  test("capture and rollback component data", () => {
    const world = makeWorld({domainId: 1, schema: [Position]})
    const history = {snapshots: [], maxSize: 10}
    addResource(world, HistoryBuffer(history))
    pushSnapshot(world, history)

    const entity = spawn(world, [Position({x: 0, y: 0})])
    commitTransaction(world)
    advanceTick(world)

    addComponent(world, entity, Position({x: 10, y: 10}))
    commitTransaction(world)
    advanceTick(world)

    expect(getComponentValue(world, entity, Position)?.x).toBe(10)

    const success = rollbackToTick(world, HistoryBuffer, 0)
    expect(success).toBe(true)
    expect(world.tick).toBe(0)
    const pos0 = getComponentValue(world, entity, Position)
    if (pos0) {
      expect(pos0.x).toBe(0)
    }
  })

  test("rollback entity spawn", () => {
    const world = makeWorld({domainId: 1, schema: [Position]})
    const history = {snapshots: [], maxSize: 10}
    addResource(world, HistoryBuffer(history))
    pushSnapshot(world, history)

    const entity = spawn(world, [Position({x: 10, y: 10})])
    commitTransaction(world)
    advanceTick(world)

    expect(getComponentValue(world, entity, Position)).toBeDefined()

    rollbackToTick(world, HistoryBuffer, 0)
    expect(world.tick).toBe(0)
    expect(getComponentValue(world, entity, Position)).toBeUndefined()
  })

  test("rollback entity despawn", () => {
    const world = makeWorld({domainId: 1, schema: [Position]})
    const history = {snapshots: [], maxSize: 10}
    addResource(world, HistoryBuffer(history))

    const entity = spawn(world, [Position({x: 10, y: 10})])
    commitTransaction(world)
    pushSnapshot(world, history)

    despawn(world, entity)
    commitTransaction(world)
    advanceTick(world)

    expect(getComponentValue(world, entity, Position)).toBeUndefined()

    rollbackToTick(world, HistoryBuffer, 0)
    expect(world.tick).toBe(0)
    expect(getComponentValue(world, entity, Position)).toBeDefined()
    const posRolled = getComponentValue(world, entity, Position)
    if (posRolled) {
      expect(posRolled.x).toBe(10)
    }
  })

  test("resimulate forward after rollback", () => {
    const world = makeWorld({domainId: 1, schema: [Position]})
    const history = {snapshots: [], maxSize: 10}
    addResource(world, HistoryBuffer(history))
    const inputBuffer = new Map<number, unknown>()
    addResource(world, InputBuffer(inputBuffer))

    const entity = spawn(world, [Position({x: 0, y: 0})])
    commitTransaction(world)

    pushSnapshot(world, history)

    inputBuffer.set(1, {dx: 1, dy: 1})
    addComponent(world, entity, Position({x: 1, y: 1}))
    commitTransaction(world)
    advanceTick(world)

    inputBuffer.set(2, {dx: 1, dy: 1})
    addComponent(world, entity, Position({x: 2, y: 2}))
    commitTransaction(world)
    advanceTick(world)

    expect(getComponentValue(world, entity, Position)?.x).toBe(2)

    rollbackToTick(world, HistoryBuffer, 0)
    expect(world.tick).toBe(0)
    const posRolledResim = getComponentValue(world, entity, Position)
    if (posRolledResim) {
      expect(posRolledResim.x).toBe(0)
    }

    resimulateWithTransactions(world, 2, (w, input: unknown) => {
      const pos = getComponentValue(w, entity, Position)
      const typedInput = input as {dx: number; dy: number}
      if (pos) {
        addComponent(
          w,
          entity,
          Position({x: pos.x + typedInput.dx, y: pos.y + typedInput.dy}),
        )
      }
    })

    expect(world.tick).toBe(2)
    const pos2 = getComponentValue(world, entity, Position)
    if (pos2) {
      expect(pos2.x).toBe(2)
    }
  })

  test("makeHistoryBuffer", () => {
    const buffer = makeHistoryBuffer(100)
    expect(buffer.maxSize).toBe(100)
    expect(buffer.snapshots).toEqual([])
  })

  test("capture and rollback relations", () => {
    const ChildOf = defineRelation()
    const world = makeWorld({domainId: 1, schema: [Position, ChildOf]})
    
    const parent = spawn(world, [Position({x: 0, y: 0})])
    const child = spawn(world, [ChildOf(parent)])
    commitTransaction(world)
    
    const snapshot = captureSnapshot(world)
    expect(snapshot.relations.objectToSubjects.has(parent)).toBe(true)
    
    despawn(world, child)
    commitTransaction(world)
    expect(world.relations.objectToSubjects.has(parent)).toBe(false)
    
    rollbackToSnapshot(world, snapshot)
    expect(world.relations.objectToSubjects.has(parent)).toBe(true)
    
    const node = sparseMapGet(world.entityGraph.byEntity, parent as number)
    expect(node?.relMaps[world.componentRegistry.getId(ChildOf)]).toBeDefined()
  })

  test("rollbackToSnapshot restores missing domain", () => {
    const world = makeWorld({domainId: 1, schema: [Position]})
    const snapshot = captureSnapshot(world)
    
    // Simulate a snapshot from another world or a world that had an extra domain
    const extraDomain = {
      domainId: 5,
      entityId: 100,
      opSeq: 10,
      entityCount: 1,
      dense: [100],
      sparse: new Map([[100, 0]]),
    }
    
    const modifiedSnapshot = {
      ...snapshot,
      registryDomains: [...snapshot.registryDomains]
    }
    modifiedSnapshot.registryDomains[5] = extraDomain
    
    rollbackToSnapshot(world, modifiedSnapshot)
    
    expect(world.registry.domains[5]).toBeDefined()
    expect(world.registry.domains[5]?.domainId).toBe(5)
    expect(world.registry.domains[5]?.opSeq).toBe(10)
  })
})
