import {describe, expect, test} from "bun:test"
import * as Component from "../component"
import * as Entity from "../entity"
import {getDomain} from "../entity_registry"
import * as Relation from "../relation"
import {
  applyTransaction,
  TRANSIENT_DOMAIN,
  type Transaction,
} from "../replication"
import {Replicated, ReplicationStream} from "../replication_config"
import * as SparseMap from "../sparse_map"
import * as World from "../world"
import * as WorldApi from "../world_api"

describe("replication", () => {
  const Position = Component.define<{x: number; y: number}>("Position")
  const Velocity = Component.define<{dx: number; dy: number}>("Velocity")
  const IsStatic = Component.defineTag("IsStatic")
  const ChildOf = Relation.define("ChildOf")
  const schema = [Position, Velocity, IsStatic, ChildOf]

  function sync(
    world: World.World,
    target: World.World,
  ) {
    const stream = World.getResource(world, ReplicationStream)
    if (stream) {
      for (const tx of stream.transactions) {
        applyTransaction(target, tx)
      }
      stream.transactions.length = 0
    }
  }

  test("basic spawn replication", () => {
    const worldA = World.create({domainId: 1})
    World.addResource(worldA, ReplicationStream({transactions: [], snapshots: []}))
    const worldB = World.create({domainId: 2})
    World.addResource(worldB, ReplicationStream({transactions: [], snapshots: []}))
    const entityA = WorldApi.spawn(worldA, Position({x: 10, y: 20}), Replicated)
    WorldApi.commitTransaction(worldA)
    sync(worldA, worldB)

    const posB = World.getComponentValue(worldB, entityA, Position)
    expect(posB).toBeDefined()
    if (posB) {
      expect(posB.x).toBe(10)
      expect(posB.y).toBe(20)
    }
    expect(Entity.domainId(entityA)).toBe(1)
  })

  test("basic component update replication", () => {
    const worldA = World.create({domainId: 1})
    World.addResource(worldA, ReplicationStream({transactions: [], snapshots: []}))
    const worldB = World.create({domainId: 2})
    World.addResource(worldB, ReplicationStream({transactions: [], snapshots: []}))
    const entityA = WorldApi.spawn(worldA, Position({x: 10, y: 20}), Replicated)
    WorldApi.addComponent(worldA, entityA, Position({x: 30, y: 40}))
    WorldApi.commitTransaction(worldA)
    sync(worldA, worldB)

    const posB = World.getComponentValue(worldB, entityA, Position)
    if (posB) {
      expect(posB.x).toBe(30)
      expect(posB.y).toBe(40)
    }
  })

  test("tag replication", () => {
    const worldA = World.create({domainId: 1})
    World.addResource(worldA, ReplicationStream({transactions: [], snapshots: []}))
    const worldB = World.create({domainId: 2})
    World.addResource(worldB, ReplicationStream({transactions: [], snapshots: []}))
    const entityA = WorldApi.spawn(worldA, IsStatic, Replicated)
    WorldApi.commitTransaction(worldA)
    sync(worldA, worldB)

    const nodeB = SparseMap.get(worldB.graph.byEntity, entityA as number)
    expect(nodeB).toBeDefined()
    expect(nodeB?.vec.ids).toContain(worldB.componentRegistry.getId(IsStatic))
  })

  test("relationship replication", () => {
    const worldA = World.create({domainId: 1})
    World.addResource(worldA, ReplicationStream({transactions: [], snapshots: []}))
    const worldB = World.create({domainId: 2})
    World.addResource(worldB, ReplicationStream({transactions: [], snapshots: []}))
    const parent = WorldApi.spawn(worldA, Position({x: 10, y: 10}), Replicated)
    const child = WorldApi.spawn(worldA, ChildOf(parent), Replicated)
    WorldApi.commitTransaction(worldA)
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
    const worldA = World.create({domainId: 1})
    World.addResource(worldA, ReplicationStream({transactions: [], snapshots: []}))
    const worldB = World.create({domainId: 2})
    World.addResource(worldB, ReplicationStream({transactions: [], snapshots: []}))
    const parent = WorldApi.spawn(worldA, Position({x: 10, y: 10}), Replicated)
    const child = WorldApi.spawn(worldA, ChildOf(parent), Replicated)
    WorldApi.commitTransaction(worldA)
    sync(worldA, worldB)

    expect(worldB.relations.objectToSubjects.has(parent)).toBe(true)

    WorldApi.removeComponent(worldA, child, ChildOf(parent))
    WorldApi.commitTransaction(worldA)
    sync(worldA, worldB)

    expect(worldB.relations.objectToSubjects.has(parent)).toBe(false)
  })

  test("addComponent replication", () => {
    const worldA = World.create({domainId: 1})
    World.addResource(worldA, ReplicationStream({transactions: [], snapshots: []}))
    const worldB = World.create({domainId: 2})
    World.addResource(worldB, ReplicationStream({transactions: [], snapshots: []}))
    const entityA = WorldApi.spawn(worldA, Position({x: 10, y: 20}), Replicated)
    WorldApi.addComponent(worldA, entityA, Velocity({dx: 1, dy: 1}))
    WorldApi.commitTransaction(worldA)
    sync(worldA, worldB)

    const velB = World.getComponentValue(worldB, entityA, Velocity)
    expect(velB).toBeDefined()
    if (velB) {
      expect(velB.dx).toBe(1)
      expect(velB.dy).toBe(1)
    }
  })

  test("removeComponent replication", () => {
    const worldA = World.create({domainId: 1})
    World.addResource(worldA, ReplicationStream({transactions: [], snapshots: []}))
    const worldB = World.create({domainId: 2})
    World.addResource(worldB, ReplicationStream({transactions: [], snapshots: []}))
    const entityA = WorldApi.spawn(
      worldA,
      Position({x: 10, y: 20}),
      Velocity({dx: 1, dy: 1}),
      Replicated,
    )
    WorldApi.commitTransaction(worldA)
    sync(worldA, worldB)
    expect(World.getComponentValue(worldB, entityA, Velocity)).toBeDefined()

    WorldApi.removeComponent(worldA, entityA, Velocity)
    WorldApi.commitTransaction(worldA)
    sync(worldA, worldB)

    expect(World.getComponentValue(worldB, entityA, Velocity)).toBeUndefined()
    expect(World.getComponentValue(worldB, entityA, Position)).toBeDefined()
  })

  test("basic despawn replication", () => {
    const worldA = World.create({domainId: 1})
    World.addResource(worldA, ReplicationStream({transactions: [], snapshots: []}))
    const worldB = World.create({domainId: 2})
    World.addResource(worldB, ReplicationStream({transactions: [], snapshots: []}))
    const entityA = WorldApi.spawn(worldA, Position({x: 10, y: 20}), Replicated)
    WorldApi.commitTransaction(worldA)
    sync(worldA, worldB)
    expect(World.getComponentValue(worldB, entityA, Position)).toBeDefined()

    WorldApi.despawn(worldA, entityA)
    WorldApi.commitTransaction(worldA)
    sync(worldA, worldB)
    expect(World.getComponentValue(worldB, entityA, Position)).toBeUndefined()
  })

  test("LWW conflict resolution (newer tick wins)", () => {
    const worldA = World.create({domainId: 1})
    World.addResource(worldA, ReplicationStream({transactions: [], snapshots: []}))
    const worldB = World.create({domainId: 2})
    World.addResource(worldB, ReplicationStream({transactions: [], snapshots: []}))
    const entity = WorldApi.spawn(worldA, Position({x: 0, y: 0}), Replicated)
    WorldApi.commitTransaction(worldA)
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

    const posB = World.getComponentValue(worldB, entity, Position)
    if (posB) {
      expect(posB.x).toBe(20)
    }
  })

  test("P2P multi-agent replication", () => {
    const worldA = World.create({domainId: 1})
    World.addResource(worldA, ReplicationStream({transactions: [], snapshots: []}))
    const worldB = World.create({domainId: 2})
    World.addResource(worldB, ReplicationStream({transactions: [], snapshots: []}))

    const entityA = WorldApi.spawn(worldA, Position({x: 1, y: 1}), Replicated)
    const entityB = WorldApi.spawn(worldB, Position({x: 2, y: 2}), Replicated)

    WorldApi.commitTransaction(worldA)
    sync(worldA, worldB)
    WorldApi.commitTransaction(worldB)
    sync(worldB, worldA)

    const posA = World.getComponentValue(worldA, entityB, Position)
    if (posA) {
      expect(posA.x).toBe(2)
    }

    const posBP2P = World.getComponentValue(worldB, entityA, Position)
    if (posBP2P) {
      expect(posBP2P.x).toBe(1)
    }
  })

  test("predictive shadowing and rebinding", () => {
    const world = World.create({domainId: 1})
    const causalKey = 12345

    const transientEntity = WorldApi.spawnInDomain(
      world,
      [Position({x: 100, y: 100}), Replicated],
      TRANSIENT_DOMAIN,
    )

    world.transients.set(causalKey, {
      entity: transientEntity,
      tick: world.tick,
    })

    const posTransient = World.getComponentValue(world, transientEntity, Position)
    if (posTransient) {
      expect(posTransient.x).toBe(100)
    }

    const serverEntity = ((0 << 20) | 500) as Entity.Entity
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

    expect(World.getComponentValue(world, transientEntity, Position)).toBeUndefined()

    const posServer = World.getComponentValue(world, serverEntity, Position)
    if (posServer) {
      expect(posServer.x).toBe(105)
    }

    expect(world.transients.has(causalKey)).toBe(true)
  })

  test("automatic causal key generation and rebinding", () => {
    const worldClient = World.create({domainId: 1})
    const worldServer = World.create({domainId: 0})
    World.addResource(
      worldServer,
      ReplicationStream({transactions: [], snapshots: []}),
    )

    worldClient.tick = 100
    worldServer.tick = 100

    const predictedEntity = WorldApi.spawnInDomain(
      worldClient,
      [Position({x: 1, y: 1}), Replicated],
      TRANSIENT_DOMAIN,
    )
    expect(worldClient.transients.size).toBe(1)

    const authoritativeEntity = WorldApi.spawn(
      worldServer,
      Position({x: 2, y: 2}),
      Replicated,
    )

    WorldApi.commitTransaction(worldServer)
    const serverTransaction = World.getResource(worldServer, ReplicationStream)
      ?.transactions[0]

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
      World.getComponentValue(worldClient, predictedEntity, Position),
    ).toBeUndefined()
    const posAuthoritative = World.getComponentValue(
      worldClient,
      authoritativeEntity,
      Position,
    )
    if (posAuthoritative) {
      expect(posAuthoritative.x).toBe(2)
    }

    expect(worldClient.transients.size).toBe(1)
  })

  test("relationship object rebinding", () => {
    const world = World.create({domainId: 1})
    const causalKey = 54321

    // A predicted parent entity
    const transientParent = WorldApi.spawnInDomain(
      world,
      [Position({x: 10, y: 10}), Replicated],
      TRANSIENT_DOMAIN,
    )
    world.transients.set(causalKey, {
      entity: transientParent,
      tick: world.tick,
    })

    // A child of the predicted parent
    const child = WorldApi.spawn(world, ChildOf(transientParent), Replicated)
    WorldApi.commitTransaction(world)

    expect(world.relations.objectToSubjects.has(transientParent)).toBe(true)

    // Server sends authoritative parent spawn with same causalKey
    const authoritativeParent = ((0 << 20) | 99) as Entity.Entity
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
    expect(
      Array.from(incoming || []).some(
        (r) =>
          r.subject === child &&
          r.relationId === world.componentRegistry.getId(ChildOf),
      ),
    ).toBe(true)
  })

  test("relationship in set op", () => {
    const world = World.create({domainId: 1})
    const parent = WorldApi.spawn(world, Position({x: 1, y: 1}), Replicated)
    const child = WorldApi.spawn(world, Position({x: 0, y: 0}), Replicated)
    WorldApi.commitTransaction(world)

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
          rel: {
            relationId: world.componentRegistry.getId(ChildOf),
            object: parent,
          },
        },
      ],
    }

    applyTransaction(world, tx)

    expect(world.relations.objectToSubjects.has(parent)).toBe(true)
    expect(world.relations.virtualToRel.has(childOfParentId)).toBe(true)
  })

  test("relationship cleanup on despawn", () => {
    const world = World.create({domainId: 1})
    const parent = WorldApi.spawn(world, Position({x: 1, y: 1}), Replicated)
    const child = WorldApi.spawn(world, ChildOf(parent), Replicated)
    WorldApi.commitTransaction(world)

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
