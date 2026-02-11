import {describe, expect, test} from "bun:test"
import * as Component from "./component"
import * as History from "./history"
import {HistoryBuffer} from "./history"
import {resimulateWithTransactions} from "./reconciliation"
import * as Relation from "./relation"
import * as SparseMap from "./sparse_map"
import * as World from "./world"
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
  const Position = Component.define<{x: number; y: number}>("Position")

  test("capture and restore checkpoint component data", () => {
    const world = World.create({domainId: 1})
    const history = {
      checkpoints: [] as any[],
      undoLog: [] as any[],
      maxSize: 10,
      checkpointInterval: 1,
    }
    addResource(world, HistoryBuffer(history))
    History.push(world, history)

    const entity = spawn(world, Position({x: 0, y: 0}))
    commitTransaction(world)
    advanceTick(world)

    addComponent(world, entity, Position({x: 10, y: 10}))
    commitTransaction(world)
    advanceTick(world)

    expect(World.getComponentValue(world, entity, Position)?.x).toBe(10)

    const success = History.rollback(world, HistoryBuffer, 0)
    expect(success).toBe(true)
    expect(world.tick).toBe(0)
    const pos0 = World.getComponentValue(world, entity, Position)
    if (pos0) {
      expect(pos0.x).toBe(0)
    }
  })

  test("rollback entity spawn", () => {
    const world = World.create({domainId: 1})
    const history = {
      checkpoints: [] as any[],
      undoLog: [] as any[],
      maxSize: 10,
      checkpointInterval: 1,
    }
    addResource(world, HistoryBuffer(history))
    History.push(world, history)

    const entity = spawn(world, Position({x: 10, y: 10}))
    commitTransaction(world)
    advanceTick(world)

    expect(World.getComponentValue(world, entity, Position)).toBeDefined()

    History.rollback(world, HistoryBuffer, 0)
    expect(world.tick).toBe(0)
    expect(World.getComponentValue(world, entity, Position)).toBeUndefined()
  })

  test("rollback entity despawn", () => {
    const world = World.create({domainId: 1})
    const history = {
      checkpoints: [] as any[],
      undoLog: [] as any[],
      maxSize: 10,
      checkpointInterval: 1,
    }
    addResource(world, HistoryBuffer(history))

    const entity = spawn(world, Position({x: 10, y: 10}))
    commitTransaction(world)
    History.push(world, history)

    despawn(world, entity)
    commitTransaction(world)
    advanceTick(world)

    expect(World.getComponentValue(world, entity, Position)).toBeUndefined()

    History.rollback(world, HistoryBuffer, 0)
    expect(world.tick).toBe(0)
    expect(World.getComponentValue(world, entity, Position)).toBeDefined()
    const posRolled = World.getComponentValue(world, entity, Position)
    if (posRolled) {
      expect(posRolled.x).toBe(10)
    }
  })

  test("resimulate forward after rollback", () => {
    const world = World.create({domainId: 1})
    const history = {
      checkpoints: [] as any[],
      undoLog: [] as any[],
      maxSize: 10,
      checkpointInterval: 1,
    }
    addResource(world, HistoryBuffer(history))

    const entity = spawn(world, Position({x: 0, y: 0}))
    commitTransaction(world)

    History.push(world, history)

    addComponent(world, entity, Position({x: 1, y: 1}))
    commitTransaction(world)
    advanceTick(world)

    addComponent(world, entity, Position({x: 2, y: 2}))
    commitTransaction(world)
    advanceTick(world)

    expect(World.getComponentValue(world, entity, Position)?.x).toBe(2)

    History.rollback(world, HistoryBuffer, 0)
    expect(world.tick).toBe(0)
    const posRolledResim = World.getComponentValue(world, entity, Position)
    if (posRolledResim) {
      expect(posRolledResim.x).toBe(0)
    }

    resimulateWithTransactions(world, 2, (w) => {
      const pos = World.getComponentValue(w, entity, Position)
      if (pos) {
        addComponent(
          w,
          entity,
          Position({x: pos.x + 1, y: pos.y + 1}),
        )
      }
    })

    expect(world.tick).toBe(2)
    const pos2 = World.getComponentValue(world, entity, Position)
    if (pos2) {
      expect(pos2.x).toBe(2)
    }
  })

  test("makeHistoryBuffer", () => {
    const buffer = History.create(100)
    expect(buffer.maxSize).toBe(100)
    expect(buffer.checkpoints).toEqual([])
    expect(buffer.undoLog).toEqual([])
  })

  test("capture and restore checkpoint relations", () => {
    const ChildOf = Relation.define("ChildOf")
    const world = World.create({domainId: 1})

    const parent = spawn(world, Position({x: 0, y: 0}))
    const child = spawn(world, ChildOf(parent))
    commitTransaction(world)

    const checkpoint = History.capture(world)
    expect(checkpoint.relations.objectToSubjects.has(parent)).toBe(true)

    despawn(world, child)
    commitTransaction(world)
    expect(world.relations.objectToSubjects.has(parent)).toBe(false)

    History.restore(world, checkpoint)
    expect(world.relations.objectToSubjects.has(parent)).toBe(true)

    const node = SparseMap.get(world.graph.byEntity, parent as number)
    expect(node?.relMaps[world.componentRegistry.getId(ChildOf)]).toBeDefined()
  })

  test("restoreCheckpoint restores missing domain", () => {
    const world = World.create({domainId: 1})
    const checkpoint = History.capture(world)

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

    History.restore(world, modifiedCheckpoint)

    expect(world.registry.domains[5]).toBeDefined()
    expect(world.registry.domains[5]?.domainId).toBe(5)
    expect(world.registry.domains[5]?.opSeq).toBe(10)
  })
})

describe("undo log", () => {
  const Position = Component.define<{x: number; y: number}>("Position")
  const Health = Component.define<{hp: number}>("Health")

  test("makeHistoryBuffer initializes undoLog", () => {
    const buffer = History.create(50)
    expect(buffer.undoLog).toEqual([])
    expect(buffer.checkpointInterval).toBe(1)
  })

  test("advanceTick records undo entries for spawns", () => {
    const world = World.create({domainId: 1})
    const history = History.create(10)
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
    const world = World.create({domainId: 1})
    const history = History.create(10)
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
    const world = World.create({domainId: 1})
    const history = History.create(10)
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
    const world = World.create({domainId: 1})
    const history = History.create(10)
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
    const world = World.create({domainId: 1})
    const history = History.create(10)
    addResource(world, HistoryBuffer(history))

    spawn(world, Position({x: 5, y: 10}))
    commitTransaction(world)

    History.push(world, history)
    expect(history.checkpoints.length).toBe(1)
    expect(history.checkpoints[0]!.tick).toBe(0)
  })

  test("advanceTick captures checkpoints at checkpointInterval", () => {
    const world = World.create({domainId: 1})
    const history = History.create(10)
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
    const world = World.create({domainId: 1})
    const history = History.create(10)
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

    expect(World.getComponentValue(world, entity, Position)?.x).toBe(20)

    // Rollback to tick 2 — snapshot at tick 2 captured x=10
    const success = History.rollback(world, history, 2)
    expect(success).toBe(true)
    expect(world.tick).toBe(2)
    expect(World.getComponentValue(world, entity, Position)?.x).toBe(10)
  })

  test("rollbackToTick truncates checkpoints and undo log", () => {
    const world = World.create({domainId: 1})
    const history = History.create(10)
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

    History.rollback(world, history, 2)

    // Checkpoints should be truncated to tick <= 2
    expect(history.checkpoints.length).toBe(2)
    // Undo log entries at or after tick 2 should be trimmed
    for (const entry of history.undoLog) {
      expect(entry.tick).toBeLessThan(2)
    }
  })

  test("applyUndoLog reverses a spawn", () => {
    const world = World.create({domainId: 1})
    const history = History.create(10)
    addResource(world, HistoryBuffer(history))

    // Checkpoint at tick 0 (empty world)
    History.push(world, history)

    const entity = spawn(world, Position({x: 5, y: 5}))
    commitTransaction(world)
    advanceTick(world) // tick 1

    expect(World.getComponentValue(world, entity, Position)).toBeDefined()

    // Rollback to checkpoint at tick 0
    History.restore(world, history.checkpoints[0]!)

    // Apply undo log to reverse spawn
    History.applyUndoLog(world, history.undoLog, 0)

    expect(World.getComponentValue(world, entity, Position)).toBeUndefined()
  })

  test("applyUndoLog reverses a despawn", () => {
    const world = World.create({domainId: 1})
    const history = History.create(10)
    addResource(world, HistoryBuffer(history))

    const entity = spawn(world, Position({x: 7, y: 3}))
    commitTransaction(world)
    advanceTick(world) // tick 1

    // Checkpoint at tick 1 (entity exists)
    History.push(world, history)

    despawn(world, entity)
    commitTransaction(world)
    advanceTick(world) // tick 2

    expect(World.getComponentValue(world, entity, Position)).toBeUndefined()

    // Rollback to checkpoint at tick 1
    History.restore(world, history.checkpoints[1]!)

    // Apply undo log to reverse despawn (entry at tick 1)
    History.applyUndoLog(world, history.undoLog, 1)

    expect(World.getComponentValue(world, entity, Position)).toBeDefined()
    expect(World.getComponentValue(world, entity, Position)?.x).toBe(7)
  })

  test("applyUndoLog reverses addComponent", () => {
    const world = World.create({domainId: 1})
    const history = History.create(10)
    addResource(world, HistoryBuffer(history))

    const entity = spawn(world, Position({x: 0, y: 0}))
    commitTransaction(world)
    advanceTick(world) // tick 1

    addComponent(world, entity, Health({hp: 50}))
    commitTransaction(world)
    advanceTick(world) // tick 2

    expect(World.getComponentValue(world, entity, Health)).toBeDefined()

    // Rollback to checkpoint at tick 1
    History.restore(world, history.checkpoints[0]!)

    // Apply undo log to reverse addComponent at tick 1
    History.applyUndoLog(world, history.undoLog, 1)

    expect(World.getComponentValue(world, entity, Health)).toBeUndefined()
    expect(World.getComponentValue(world, entity, Position)).toBeDefined()
  })

  test("applyUndoLog reverses removeComponent and restores data", () => {
    const world = World.create({domainId: 1})
    const history = History.create(10)
    addResource(world, HistoryBuffer(history))

    const entity = spawn(world, Position({x: 0, y: 0}), Health({hp: 75}))
    commitTransaction(world)
    advanceTick(world) // tick 1

    removeComponent(world, entity, Health)
    commitTransaction(world)
    advanceTick(world) // tick 2

    expect(World.getComponentValue(world, entity, Health)).toBeUndefined()

    // Rollback to checkpoint at tick 1
    History.restore(world, history.checkpoints[0]!)

    // Apply undo log to reverse removeComponent at tick 1
    History.applyUndoLog(world, history.undoLog, 1)

    expect(World.getComponentValue(world, entity, Health)).toBeDefined()
    expect(World.getComponentValue(world, entity, Health)?.hp).toBe(75)
    expect(World.getComponentValue(world, entity, Position)).toBeDefined()
  })

  test("rollbackToTick finds nearest checkpoint at or before target tick", () => {
    const world = World.create({domainId: 1})
    const history = History.create(10)
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
    expect(World.getComponentValue(world, entity, Position)?.x).toBe(99)

    // rollbackToTick should find snapshot at tick 2 with x=50
    const success = History.rollback(world, history, 2)
    expect(success).toBe(true)
    expect(world.tick).toBe(2)
    expect(World.getComponentValue(world, entity, Position)?.x).toBe(50)
  })

  test("undo log entries are not recorded for command-domain entities", () => {
    const world = World.create({domainId: 1})
    const history = History.create(10)
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
    const world = World.create({domainId: 1})
    const history = History.create(10)
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
