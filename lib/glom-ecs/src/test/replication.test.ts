import {describe, expect, test} from "bun:test"
import {defineComponent, defineTag} from "../component"
import {type Entity, getDomainId} from "../entity"
import {getDomain} from "../entity_registry"
import {defineRelation} from "../relation"
import {
  applyTransaction,
  TRANSIENT_DOMAIN,
  type Transaction,
} from "../replication"
import {Replicated, ReplicationStream} from "../replication_config"
import {sparseMapGet} from "../sparse_map"
import {addResource, getComponentValue, getResource, makeWorld} from "../world"
import {
  addComponent,
  commitTransaction,
  despawn,
  removeComponent,
  spawn,
  spawnInDomain,
} from "../world_api"

describe("replication", () => {
  const Position = defineComponent<{x: number; y: number}>()
  const Velocity = defineComponent<{dx: number; dy: number}>()
  const IsStatic = defineTag()
  const ChildOf = defineRelation()
  const schema = [Position, Velocity, IsStatic, ChildOf]

  function sync(world: ReturnType<typeof makeWorld>, target: ReturnType<typeof makeWorld>) {
    const stream = getResource(world, ReplicationStream)
    if (stream) {
      for (const tx of stream.transactions) {
        applyTransaction(target, tx)
      }
      stream.transactions.length = 0
    }
  }

  test("basic spawn replication", () => {
    const worldA = makeWorld({domainId: 1, schema})
    addResource(worldA, ReplicationStream({transactions: [], snapshots: []}))
    const worldB = makeWorld({domainId: 2, schema})
    addResource(worldB, ReplicationStream({transactions: [], snapshots: []}))
    const entityA = spawn(worldA, Position({x: 10, y: 20}), Replicated)
    commitTransaction(worldA)
    sync(worldA, worldB)

    const posB = getComponentValue(worldB, entityA, Position)
    expect(posB).toBeDefined()
    if (posB) {
      expect(posB.x).toBe(10)
      expect(posB.y).toBe(20)
    }
    expect(getDomainId(entityA)).toBe(1)
  })

  test("basic component update replication", () => {
    const worldA = makeWorld({domainId: 1, schema})
    addResource(worldA, ReplicationStream({transactions: [], snapshots: []}))
    const worldB = makeWorld({domainId: 2, schema})
    addResource(worldB, ReplicationStream({transactions: [], snapshots: []}))
    const entityA = spawn(worldA, Position({x: 10, y: 20}), Replicated)
    addComponent(worldA, entityA, Position({x: 30, y: 40}))
    commitTransaction(worldA)
    sync(worldA, worldB)

    const posB = getComponentValue(worldB, entityA, Position)
    if (posB) {
      expect(posB.x).toBe(30)
      expect(posB.y).toBe(40)
    }
  })

  test("tag replication", () => {
    const worldA = makeWorld({domainId: 1, schema})
    addResource(worldA, ReplicationStream({transactions: [], snapshots: []}))
    const worldB = makeWorld({domainId: 2, schema})
    addResource(worldB, ReplicationStream({transactions: [], snapshots: []}))
    const entityA = spawn(worldA, IsStatic, Replicated)
    commitTransaction(worldA)
    sync(worldA, worldB)

    const nodeB = sparseMapGet(
      worldB.entityGraph.byEntity,
      entityA as number,
    )
    expect(nodeB).toBeDefined()
    expect(nodeB?.vec.ids).toContain(
      worldB.componentRegistry.getId(IsStatic),
    )
  })

  test("relationship replication", () => {
    const worldA = makeWorld({domainId: 1, schema})
    addResource(worldA, ReplicationStream({transactions: [], snapshots: []}))
    const worldB = makeWorld({domainId: 2, schema})
    addResource(worldB, ReplicationStream({transactions: [], snapshots: []}))
    const parent = spawn(worldA, Position({x: 10, y: 10}), Replicated)
    const child = spawn(worldA, ChildOf(parent), Replicated)
    commitTransaction(worldA)
    sync(worldA, worldB)

    const incoming = worldB.relations.objectToSubjects.get(parent)
    expect(incoming).toBeDefined()
    if (incoming) {
      expect(
        Array.from(incoming).some(
          (r) =>
            r.subject === child &&
            r.relationId === worldB.componentRegistry.getId(ChildOf),
        ),
      ).toBe(true)
    }
  })

  test("relationship removal replication", () => {
    const worldA = makeWorld({domainId: 1, schema})
    addResource(worldA, ReplicationStream({transactions: [], snapshots: []}))
    const worldB = makeWorld({domainId: 2, schema})
    addResource(worldB, ReplicationStream({transactions: [], snapshots: []}))
    const parent = spawn(worldA, Position({x: 10, y: 10}), Replicated)
    const child = spawn(worldA, ChildOf(parent), Replicated)
    commitTransaction(worldA)
    sync(worldA, worldB)

    expect(worldB.relations.objectToSubjects.has(parent)).toBe(true)

    removeComponent(worldA, child, ChildOf(parent))
    commitTransaction(worldA)
    sync(worldA, worldB)

    expect(worldB.relations.objectToSubjects.has(parent)).toBe(false)
  })

  test("addComponent replication", () => {
    const worldA = makeWorld({domainId: 1, schema})
    addResource(worldA, ReplicationStream({transactions: [], snapshots: []}))
    const worldB = makeWorld({domainId: 2, schema})
    addResource(worldB, ReplicationStream({transactions: [], snapshots: []}))
    const entityA = spawn(worldA, Position({x: 10, y: 20}), Replicated)
    addComponent(worldA, entityA, Velocity({dx: 1, dy: 1}))
    commitTransaction(worldA)
    sync(worldA, worldB)

    const velB = getComponentValue(worldB, entityA, Velocity)
    expect(velB).toBeDefined()
    if (velB) {
      expect(velB.dx).toBe(1)
      expect(velB.dy).toBe(1)
    }
  })

  test("removeComponent replication", () => {
    const worldA = makeWorld({domainId: 1, schema})
    addResource(worldA, ReplicationStream({transactions: [], snapshots: []}))
    const worldB = makeWorld({domainId: 2, schema})
    addResource(worldB, ReplicationStream({transactions: [], snapshots: []}))
    const entityA = spawn(
      worldA,
      Position({x: 10, y: 20}),
      Velocity({dx: 1, dy: 1}),
      Replicated,
    )
    commitTransaction(worldA)
    sync(worldA, worldB)
    expect(getComponentValue(worldB, entityA, Velocity)).toBeDefined()

    removeComponent(worldA, entityA, Velocity)
    commitTransaction(worldA)
    sync(worldA, worldB)

    expect(getComponentValue(worldB, entityA, Velocity)).toBeUndefined()
    expect(getComponentValue(worldB, entityA, Position)).toBeDefined()
  })

  test("basic despawn replication", () => {
    const worldA = makeWorld({domainId: 1, schema})
    addResource(worldA, ReplicationStream({transactions: [], snapshots: []}))
    const worldB = makeWorld({domainId: 2, schema})
    addResource(worldB, ReplicationStream({transactions: [], snapshots: []}))
    const entityA = spawn(worldA, Position({x: 10, y: 20}), Replicated)
    commitTransaction(worldA)
    sync(worldA, worldB)
    expect(getComponentValue(worldB, entityA, Position)).toBeDefined()

    despawn(worldA, entityA)
    commitTransaction(worldA)
    sync(worldA, worldB)
    expect(getComponentValue(worldB, entityA, Position)).toBeUndefined()
  })

  test("LWW conflict resolution (newer tick wins)", () => {
    const worldA = makeWorld({domainId: 1, schema})
    addResource(worldA, ReplicationStream({transactions: [], snapshots: []}))
    const worldB = makeWorld({domainId: 2, schema})
    addResource(worldB, ReplicationStream({transactions: [], snapshots: []}))
    const entity = spawn(worldA, Position({x: 0, y: 0}), Replicated)
    commitTransaction(worldA)
    sync(worldA, worldB)

    const tx1: Transaction = {
      domainId: 1,
      seq: getDomain(worldB.registry, 1).opSeq + 1,
      tick: 10,
      ops: [
        {
          type: "set",
          entity,
          componentId: worldB.componentRegistry.getId(Position),
          data: {x: 10, y: 10},
        },
      ],
    }

    const tx2: Transaction = {
      domainId: 1,
      seq: getDomain(worldB.registry, 1).opSeq,
      tick: 20,
      ops: [
        {
          type: "set",
          entity,
          componentId: worldB.componentRegistry.getId(Position),
          data: {x: 20, y: 20},
        },
      ],
    }

    applyTransaction(worldB, tx2)
    applyTransaction(worldB, tx1)

    const posB = getComponentValue(worldB, entity, Position)
    if (posB) {
      expect(posB.x).toBe(20)
    }
  })

  test("P2P multi-agent replication", () => {
    const worldA = makeWorld({domainId: 1, schema})
    addResource(worldA, ReplicationStream({transactions: [], snapshots: []}))
    const worldB = makeWorld({domainId: 2, schema})
    addResource(worldB, ReplicationStream({transactions: [], snapshots: []}))

    const entityA = spawn(worldA, Position({x: 1, y: 1}), Replicated)
    const entityB = spawn(worldB, Position({x: 2, y: 2}), Replicated)

    commitTransaction(worldA)
    sync(worldA, worldB)
    commitTransaction(worldB)
    sync(worldB, worldA)

    const posA = getComponentValue(worldA, entityB, Position)
    if (posA) {
      expect(posA.x).toBe(2)
    }

    const posBP2P = getComponentValue(worldB, entityA, Position)
    if (posBP2P) {
      expect(posBP2P.x).toBe(1)
    }
  })

  test("predictive shadowing and rebinding", () => {
    const world = makeWorld({domainId: 1, schema})
    const causalKey = 12345

    const transientEntity = spawnInDomain(
      world,
      [Position({x: 100, y: 100}), Replicated],
      TRANSIENT_DOMAIN,
    )

    world.transientRegistry.set(causalKey, {
      entity: transientEntity,
      tick: world.tick,
    })

    const posTransient = getComponentValue(world, transientEntity, Position)
    if (posTransient) {
      expect(posTransient.x).toBe(100)
    }

    const serverEntity = ((0 << 20) | 500) as Entity
    const transaction: Transaction = {
      domainId: 0,
      seq: 1,
      tick: 100,
      ops: [
        {
          type: "spawn",
          entity: serverEntity,
          causalKey: causalKey,
          components: [
            {
              id: world.componentRegistry.getId(Position),
              data: {x: 105, y: 105},
            },
          ],
        },
      ],
    }

    applyTransaction(world, transaction)

    expect(
      getComponentValue(world, transientEntity, Position),
    ).toBeUndefined()

    const posServer = getComponentValue(world, serverEntity, Position)
    if (posServer) {
      expect(posServer.x).toBe(105)
    }

    expect(world.transientRegistry.has(causalKey)).toBe(true)
  })

  test("automatic causal key generation and rebinding", () => {
    const worldClient = makeWorld({domainId: 1, schema})
    const worldServer = makeWorld({domainId: 0, schema})
    addResource(worldServer, ReplicationStream({transactions: [], snapshots: []}))

    worldClient.tick = 100
    worldServer.tick = 100

    const predictedEntity = spawnInDomain(
      worldClient,
      [Position({x: 1, y: 1}), Replicated],
      TRANSIENT_DOMAIN,
    )
    expect(worldClient.transientRegistry.size).toBe(1)

    const authoritativeEntity = spawn(
      worldServer,
      Position({x: 2, y: 2}),
      Replicated,
    )

    commitTransaction(worldServer)
    const serverTransaction = getResource(worldServer, ReplicationStream)?.transactions[0]

    expect(serverTransaction).toBeDefined()
    const op = serverTransaction?.ops[0]
    expect(op?.type).toBe("spawn")
    if (op?.type === "spawn") {
      expect(op.causalKey).toBeDefined()
    }

    if (serverTransaction) {
      applyTransaction(worldClient, serverTransaction)
    }

    expect(
      getComponentValue(worldClient, predictedEntity, Position),
    ).toBeUndefined()
    const posAuthoritative = getComponentValue(
      worldClient,
      authoritativeEntity,
      Position,
    )
    if (posAuthoritative) {
      expect(posAuthoritative.x).toBe(2)
    }

    expect(worldClient.transientRegistry.size).toBe(1)
  })

  test("relationship object rebinding", () => {
    const world = makeWorld({domainId: 1, schema})
    const causalKey = 54321

    // A predicted parent entity
    const transientParent = spawnInDomain(
      world,
      [Position({x: 10, y: 10}), Replicated],
      TRANSIENT_DOMAIN,
    )
    world.transientRegistry.set(causalKey, {
      entity: transientParent,
      tick: world.tick,
    })

    // A child of the predicted parent
    const child = spawn(world, ChildOf(transientParent), Replicated)
    commitTransaction(world)

    expect(world.relations.objectToSubjects.has(transientParent)).toBe(true)

    // Server sends authoritative parent spawn with same causalKey
    const authoritativeParent = ((0 << 20) | 99) as Entity
    const transaction: Transaction = {
      domainId: 0,
      seq: 1,
      tick: 100,
      ops: [
        {
          type: "spawn",
          entity: authoritativeParent,
          causalKey: causalKey,
          components: [
            {
              id: world.componentRegistry.getId(Position),
              data: {x: 10, y: 10},
            },
          ],
        },
      ],
    }

    applyTransaction(world, transaction)

    // The relation should now point to the authoritative parent
    expect(world.relations.objectToSubjects.has(transientParent)).toBe(false)
    expect(world.relations.objectToSubjects.has(authoritativeParent)).toBe(true)
    const incoming = world.relations.objectToSubjects.get(authoritativeParent)
    expect(Array.from(incoming || []).some(r => r.subject === child && r.relationId === world.componentRegistry.getId(ChildOf))).toBe(true)
  })

  test("relationship in set op", () => {
    const world = makeWorld({domainId: 1, schema})
    const parent = spawn(world, Position({x: 1, y: 1}), Replicated)
    const child = spawn(world, Position({x: 0, y: 0}), Replicated)
    commitTransaction(world)

    const childOfParentId = 1000000 // A virtual ID
    
    const tx: Transaction = {
      domainId: 1,
      seq: getDomain(world.registry, 1).opSeq,
      tick: 10,
      ops: [
        {
          type: "set",
          entity: child,
          componentId: childOfParentId,
          data: undefined,
          rel: {relationId: world.componentRegistry.getId(ChildOf), object: parent},
        },
      ],
    }

    applyTransaction(world, tx)

    expect(world.relations.objectToSubjects.has(parent)).toBe(true)
    expect(world.relations.virtualToRel.has(childOfParentId)).toBe(true)
  })

  test("relationship cleanup on despawn", () => {
    const world = makeWorld({domainId: 1, schema})
    const parent = spawn(world, Position({x: 1, y: 1}), Replicated)
    const child = spawn(world, ChildOf(parent), Replicated)
    commitTransaction(world)

    expect(world.relations.objectToSubjects.has(parent)).toBe(true)
    const childOfParentId = Array.from(world.relations.virtualToRel.keys())[0]!
    expect(world.relations.virtualToRel.has(childOfParentId)).toBe(true)

    const tx: Transaction = {
      domainId: 1,
      seq: getDomain(world.registry, 1).opSeq,
      tick: 10,
      ops: [{type: "despawn", entity: child}],
    }

    applyTransaction(world, tx)

    expect(world.relations.objectToSubjects.has(parent)).toBe(false)
  })
})
