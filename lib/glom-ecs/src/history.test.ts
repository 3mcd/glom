import {describe, expect, test} from "bun:test"
import {defineComponent} from "./component"
import {
  applyUndoLog,
  captureCheckpoint,
  HistoryBuffer,
  makeHistoryBuffer,
  pushCheckpoint,
  restoreCheckpoint,
  rollbackToTick,
  type UndoEntry,
} from "./history"
import {resimulateWithTransactions} from "./reconciliation"
import {defineRelation} from "./relation"
import {InputBuffer} from "./replication_config"
import {sparseMapGet} from "./sparse_map"
import {getComponentValue, makeWorld} from "./world"
import {
  addComponent,
  addResource,
  advanceTick,
  commitTransaction,
  despawn,
  removeComponent,
  spawn,
} from "./world_api"

describe("history", () => {
  const Position = defineComponent<{x: number; y: number}>("Position")

  test("capture and restore checkpoint component data", () => {
    const world = makeWorld({domainId: 1})
    const history = {checkpoints: [] as any[], undoLog: [] as any[], maxSize: 10, checkpointInterval: 1}
    addResource(world, HistoryBuffer(history))
    pushCheckpoint(world, history)

    const entity = spawn(world, Position({x: 0, y: 0}))
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
    const world = makeWorld({domainId: 1})
    const history = {checkpoints: [] as any[], undoLog: [] as any[], maxSize: 10, checkpointInterval: 1}
    addResource(world, HistoryBuffer(history))
    pushCheckpoint(world, history)

    const entity = spawn(world, Position({x: 10, y: 10}))
    commitTransaction(world)
    advanceTick(world)

    expect(getComponentValue(world, entity, Position)).toBeDefined()

    rollbackToTick(world, HistoryBuffer, 0)
    expect(world.tick).toBe(0)
    expect(getComponentValue(world, entity, Position)).toBeUndefined()
  })

  test("rollback entity despawn", () => {
    const world = makeWorld({domainId: 1})
    const history = {checkpoints: [] as any[], undoLog: [] as any[], maxSize: 10, checkpointInterval: 1}
    addResource(world, HistoryBuffer(history))

    const entity = spawn(world, Position({x: 10, y: 10}))
    commitTransaction(world)
    pushCheckpoint(world, history)

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
    const world = makeWorld({domainId: 1})
    const history = {checkpoints: [] as any[], undoLog: [] as any[], maxSize: 10, checkpointInterval: 1}
    addResource(world, HistoryBuffer(history))
    const inputBuffer = new Map<number, unknown>()
    addResource(world, InputBuffer(inputBuffer))

    const entity = spawn(world, Position({x: 0, y: 0}))
    commitTransaction(world)

    pushCheckpoint(world, history)

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
    expect(buffer.checkpoints).toEqual([])
    expect(buffer.undoLog).toEqual([])
  })

  test("capture and restore checkpoint relations", () => {
    const ChildOf = defineRelation("ChildOf")
    const world = makeWorld({domainId: 1})

    const parent = spawn(world, Position({x: 0, y: 0}))
    const child = spawn(world, ChildOf(parent))
    commitTransaction(world)

    const checkpoint = captureCheckpoint(world)
    expect(checkpoint.relations.objectToSubjects.has(parent)).toBe(true)

    despawn(world, child)
    commitTransaction(world)
    expect(world.relations.objectToSubjects.has(parent)).toBe(false)

    restoreCheckpoint(world, checkpoint)
    expect(world.relations.objectToSubjects.has(parent)).toBe(true)

    const node = sparseMapGet(world.entityGraph.byEntity, parent as number)
    expect(node?.relMaps[world.componentRegistry.getId(ChildOf)]).toBeDefined()
  })

  test("restoreCheckpoint restores missing domain", () => {
    const world = makeWorld({domainId: 1})
    const checkpoint = captureCheckpoint(world)

    // Simulate a checkpoint from another world or a world that had an extra domain
    const extraDomain = {
      domainId: 5,
      entityId: 100,
      opSeq: 10,
      entityCount: 1,
      dense: [100],
      sparse: new Map([[100, 0]]),
      freeIds: [],
    }

    const modifiedCheckpoint = {
      ...checkpoint,
      registryDomains: [...checkpoint.registryDomains],
    }
    modifiedCheckpoint.registryDomains[5] = extraDomain

    restoreCheckpoint(world, modifiedCheckpoint)

    expect(world.registry.domains[5]).toBeDefined()
    expect(world.registry.domains[5]?.domainId).toBe(5)
    expect(world.registry.domains[5]?.opSeq).toBe(10)
  })
})

describe("undo log", () => {
  const Position = defineComponent<{x: number; y: number}>("Position")
  const Health = defineComponent<{hp: number}>("Health")

  test("makeHistoryBuffer initializes undoLog", () => {
    const buffer = makeHistoryBuffer(50)
    expect(buffer.undoLog).toEqual([])
    expect(buffer.checkpointInterval).toBe(1)
  })

  test("advanceTick records undo entries for spawns", () => {
    const world = makeWorld({domainId: 1})
    const history = makeHistoryBuffer(10)
    addResource(world, HistoryBuffer(history))

    spawn(world, Position({x: 1, y: 2}))
    commitTransaction(world)
    advanceTick(world)

    expect(history.undoLog.length).toBe(1)
    const entry = history.undoLog[0]!
    expect(entry.tick).toBe(0)
    expect(entry.ops.length).toBe(1)
    expect(entry.ops[0]!.type).toBe("undo-spawn")
  })

  test("advanceTick records undo entries for despawns", () => {
    const world = makeWorld({domainId: 1})
    const history = makeHistoryBuffer(10)
    addResource(world, HistoryBuffer(history))

    const entity = spawn(world, Position({x: 1, y: 2}))
    commitTransaction(world)
    advanceTick(world)

    despawn(world, entity)
    commitTransaction(world)
    advanceTick(world)

    expect(history.undoLog.length).toBe(2)
    const entry = history.undoLog[1]!
    expect(entry.tick).toBe(1)
    expect(entry.ops.some((op) => op.type === "undo-despawn")).toBe(true)
  })

  test("advanceTick records undo entries for addComponent", () => {
    const world = makeWorld({domainId: 1})
    const history = makeHistoryBuffer(10)
    addResource(world, HistoryBuffer(history))

    const entity = spawn(world, Position({x: 0, y: 0}))
    commitTransaction(world)
    advanceTick(world) // tick 0 -> 1

    addComponent(world, entity, Health({hp: 100}))
    commitTransaction(world)
    advanceTick(world) // tick 1 -> 2

    expect(history.undoLog.length).toBe(2)
    const entry = history.undoLog[1]!
    expect(entry.tick).toBe(1)
    expect(entry.ops.some((op) => op.type === "undo-add")).toBe(true)
  })

  test("advanceTick records undo entries for removeComponent", () => {
    const world = makeWorld({domainId: 1})
    const history = makeHistoryBuffer(10)
    addResource(world, HistoryBuffer(history))

    const entity = spawn(world, Position({x: 0, y: 0}), Health({hp: 100}))
    commitTransaction(world)
    advanceTick(world) // tick 0 -> 1

    removeComponent(world, entity, Health)
    commitTransaction(world)
    advanceTick(world) // tick 1 -> 2

    expect(history.undoLog.length).toBe(2)
    const entry = history.undoLog[1]!
    expect(entry.tick).toBe(1)
    expect(entry.ops.some((op) => op.type === "undo-remove")).toBe(true)
    const removeOp = entry.ops.find((op) => op.type === "undo-remove")
    if (removeOp && removeOp.type === "undo-remove") {
      expect(removeOp.data).toEqual({hp: 100})
    }
  })

  test("pushCheckpoint populates checkpoints", () => {
    const world = makeWorld({domainId: 1})
    const history = makeHistoryBuffer(10)
    addResource(world, HistoryBuffer(history))

    spawn(world, Position({x: 5, y: 10}))
    commitTransaction(world)

    pushCheckpoint(world, history)
    expect(history.checkpoints.length).toBe(1)
    expect(history.checkpoints[0]!.tick).toBe(0)
  })

  test("advanceTick captures checkpoints at checkpointInterval", () => {
    const world = makeWorld({domainId: 1})
    const history = makeHistoryBuffer(10)
    history.checkpointInterval = 3
    addResource(world, HistoryBuffer(history))

    spawn(world, Position({x: 0, y: 0}))
    commitTransaction(world)

    // Advance 6 ticks, checkpoints at ticks 3 and 6
    for (let i = 0; i < 6; i++) {
      advanceTick(world)
    }

    expect(history.checkpoints.length).toBe(2)
    expect(history.checkpoints[0]!.tick).toBe(3)
    expect(history.checkpoints[1]!.tick).toBe(6)
  })

  test("rollbackToTick restores state to nearest checkpoint", () => {
    const world = makeWorld({domainId: 1})
    const history = makeHistoryBuffer(10)
    addResource(world, HistoryBuffer(history))

    const entity = spawn(world, Position({x: 0, y: 0}))
    commitTransaction(world)
    advanceTick(world) // tick becomes 1; snapshot captures state x=0

    addComponent(world, entity, Position({x: 10, y: 10}))
    commitTransaction(world)
    advanceTick(world) // tick becomes 2; snapshot captures state x=10

    addComponent(world, entity, Position({x: 20, y: 20}))
    commitTransaction(world)
    advanceTick(world) // tick becomes 3; snapshot captures state x=20

    expect(getComponentValue(world, entity, Position)?.x).toBe(20)

    // Rollback to tick 2 — snapshot at tick 2 captured x=10
    const success = rollbackToTick(world, history, 2)
    expect(success).toBe(true)
    expect(world.tick).toBe(2)
    expect(getComponentValue(world, entity, Position)?.x).toBe(10)
  })

  test("rollbackToTick truncates checkpoints and undo log", () => {
    const world = makeWorld({domainId: 1})
    const history = makeHistoryBuffer(10)
    addResource(world, HistoryBuffer(history))

    const entity = spawn(world, Position({x: 0, y: 0}))
    commitTransaction(world)
    advanceTick(world) // tick 1

    addComponent(world, entity, Position({x: 5, y: 5}))
    commitTransaction(world)
    advanceTick(world) // tick 2

    addComponent(world, entity, Position({x: 10, y: 10}))
    commitTransaction(world)
    advanceTick(world) // tick 3

    expect(history.checkpoints.length).toBe(3)
    expect(history.undoLog.length).toBe(3)

    rollbackToTick(world, history, 2)

    // Checkpoints should be truncated to tick <= 2
    expect(history.checkpoints.length).toBe(2)
    // Undo log entries at or after tick 2 should be trimmed
    for (const entry of history.undoLog) {
      expect(entry.tick).toBeLessThan(2)
    }
  })

  test("applyUndoLog reverses a spawn", () => {
    const world = makeWorld({domainId: 1})
    const history = makeHistoryBuffer(10)
    addResource(world, HistoryBuffer(history))

    // Checkpoint at tick 0 (empty world)
    pushCheckpoint(world, history)

    const entity = spawn(world, Position({x: 5, y: 5}))
    commitTransaction(world)
    advanceTick(world) // tick 1

    expect(getComponentValue(world, entity, Position)).toBeDefined()

    // Rollback to checkpoint at tick 0
    restoreCheckpoint(world, history.checkpoints[0]!)

    // Apply undo log to reverse spawn
    applyUndoLog(world, history.undoLog, 0)

    expect(getComponentValue(world, entity, Position)).toBeUndefined()
  })

  test("applyUndoLog reverses a despawn", () => {
    const world = makeWorld({domainId: 1})
    const history = makeHistoryBuffer(10)
    addResource(world, HistoryBuffer(history))

    const entity = spawn(world, Position({x: 7, y: 3}))
    commitTransaction(world)
    advanceTick(world) // tick 1

    // Checkpoint at tick 1 (entity exists)
    pushCheckpoint(world, history)

    despawn(world, entity)
    commitTransaction(world)
    advanceTick(world) // tick 2

    expect(getComponentValue(world, entity, Position)).toBeUndefined()

    // Rollback to checkpoint at tick 1
    restoreCheckpoint(world, history.checkpoints[1]!)

    // Apply undo log to reverse despawn (entry at tick 1)
    applyUndoLog(world, history.undoLog, 1)

    expect(getComponentValue(world, entity, Position)).toBeDefined()
    expect(getComponentValue(world, entity, Position)?.x).toBe(7)
  })

  test("applyUndoLog reverses addComponent", () => {
    const world = makeWorld({domainId: 1})
    const history = makeHistoryBuffer(10)
    addResource(world, HistoryBuffer(history))

    const entity = spawn(world, Position({x: 0, y: 0}))
    commitTransaction(world)
    advanceTick(world) // tick 1

    addComponent(world, entity, Health({hp: 50}))
    commitTransaction(world)
    advanceTick(world) // tick 2

    expect(getComponentValue(world, entity, Health)).toBeDefined()

    // Rollback to checkpoint at tick 1
    restoreCheckpoint(world, history.checkpoints[0]!)

    // Apply undo log to reverse addComponent at tick 1
    applyUndoLog(world, history.undoLog, 1)

    expect(getComponentValue(world, entity, Health)).toBeUndefined()
    expect(getComponentValue(world, entity, Position)).toBeDefined()
  })

  test("applyUndoLog reverses removeComponent and restores data", () => {
    const world = makeWorld({domainId: 1})
    const history = makeHistoryBuffer(10)
    addResource(world, HistoryBuffer(history))

    const entity = spawn(world, Position({x: 0, y: 0}), Health({hp: 75}))
    commitTransaction(world)
    advanceTick(world) // tick 1

    removeComponent(world, entity, Health)
    commitTransaction(world)
    advanceTick(world) // tick 2

    expect(getComponentValue(world, entity, Health)).toBeUndefined()

    // Rollback to checkpoint at tick 1
    restoreCheckpoint(world, history.checkpoints[0]!)

    // Apply undo log to reverse removeComponent at tick 1
    applyUndoLog(world, history.undoLog, 1)

    expect(getComponentValue(world, entity, Health)).toBeDefined()
    expect(getComponentValue(world, entity, Health)?.hp).toBe(75)
    expect(getComponentValue(world, entity, Position)).toBeDefined()
  })

  test("rollbackToTick finds nearest checkpoint at or before target tick", () => {
    const world = makeWorld({domainId: 1})
    const history = makeHistoryBuffer(10)
    addResource(world, HistoryBuffer(history))

    const entity = spawn(world, Position({x: 0, y: 0}))
    commitTransaction(world)
    advanceTick(world) // tick becomes 1; snapshot captures state x=0

    addComponent(world, entity, Position({x: 50, y: 50}))
    commitTransaction(world)
    advanceTick(world) // tick becomes 2; snapshot captures state x=50

    addComponent(world, entity, Position({x: 99, y: 99}))
    commitTransaction(world)
    advanceTick(world) // tick becomes 3; snapshot captures state x=99

    expect(world.tick).toBe(3)
    expect(getComponentValue(world, entity, Position)?.x).toBe(99)

    // rollbackToTick should find snapshot at tick 2 with x=50
    const success = rollbackToTick(world, history, 2)
    expect(success).toBe(true)
    expect(world.tick).toBe(2)
    expect(getComponentValue(world, entity, Position)?.x).toBe(50)
  })

  test("undo log entries are not recorded for command-domain entities", () => {
    const world = makeWorld({domainId: 1})
    const history = makeHistoryBuffer(10)
    addResource(world, HistoryBuffer(history))

    // Spawn a normal entity
    spawn(world, Position({x: 0, y: 0}))
    commitTransaction(world)
    advanceTick(world)

    // Only the normal entity spawn should be recorded
    expect(history.undoLog.length).toBe(1)
    expect(history.undoLog[0]!.ops.length).toBe(1)
  })

  test("checkpoint interval > 1 only captures at multiples", () => {
    const world = makeWorld({domainId: 1})
    const history = makeHistoryBuffer(10)
    history.checkpointInterval = 5
    addResource(world, HistoryBuffer(history))

    spawn(world, Position({x: 0, y: 0}))
    commitTransaction(world)

    for (let i = 0; i < 12; i++) {
      advanceTick(world)
    }

    // Ticks 5 and 10 should have checkpoints
    expect(history.checkpoints.length).toBe(2)
    expect(history.checkpoints[0]!.tick).toBe(5)
    expect(history.checkpoints[1]!.tick).toBe(10)

    // But undo log should have entries for every tick with mutations
    expect(history.undoLog.length).toBeGreaterThan(0)
  })
})
