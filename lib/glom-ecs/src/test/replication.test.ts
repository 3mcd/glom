import { describe, expect, test } from "bun:test"
import { define_component, define_tag } from "../component"
import { type Entity, get_hi } from "../entity"
import { get_domain } from "../entity_registry"
import { define_relation } from "../relation"
import {
  apply_transaction,
  TRANSIENT_DOMAIN,
  type Transaction,
} from "../replication"
import { Replicated } from "../replication_config"
import { sparse_map_get } from "../sparse_map"
import { get_component_value, make_world } from "../world"
import {
  add_component,
  commit_transaction,
  despawn,
  remove_component,
  spawn,
} from "../world_api"

describe("replication", () => {
  const Position = define_component<{ x: number; y: number }>()
  const Velocity = define_component<{ dx: number; dy: number }>()
  const IsStatic = define_tag()
  const ChildOf = define_relation()
  const schema = [Position, Velocity, IsStatic, ChildOf]

  function create_link(
    source: ReturnType<typeof make_world>,
    target: ReturnType<typeof make_world>,
  ) {
    source.recorder = (transaction: Transaction) => {
      apply_transaction(target, transaction)
    }
  }

  test("basic spawn replication", () => {
    const world_a = make_world(1, schema) // Domain 1
    const world_b = make_world(2, schema) // Domain 2
    create_link(world_a, world_b)

    const entity_a = spawn(world_a, [Position({ x: 10, y: 20 }), Replicated])
    commit_transaction(world_a)

    // Check world B
    const pos_b = get_component_value(world_b, entity_a, Position)
    expect(pos_b).toBeDefined()
    if (pos_b) {
      expect(pos_b.x).toBe(10)
      expect(pos_b.y).toBe(20)
    }
    expect(get_hi(entity_a)).toBe(1)
  })

  test("basic component update replication", () => {
    const world_a = make_world(1, schema)
    const world_b = make_world(2, schema)
    create_link(world_a, world_b)

    const entity_a = spawn(world_a, [Position({ x: 10, y: 20 }), Replicated])
    add_component(world_a, entity_a, Position({ x: 30, y: 40 }))
    commit_transaction(world_a)

    const pos_b = get_component_value(world_b, entity_a, Position)
    if (pos_b) {
      expect(pos_b.x).toBe(30)
      expect(pos_b.y).toBe(40)
    }
  })

  test("tag replication", () => {
    const world_a = make_world(1, schema)
    const world_b = make_world(2, schema)
    create_link(world_a, world_b)

    const entity_a = spawn(world_a, [IsStatic, Replicated])
    commit_transaction(world_a)

    // Verify tag exists in world B's entity graph for this entity
    const node_b = sparse_map_get(
      world_b.entity_graph.by_entity,
      entity_a as number,
    )
    expect(node_b).toBeDefined()
    expect(node_b?.vec.ids).toContain(world_b.component_registry.get_id(IsStatic))
  })

  test("relationship replication", () => {
    const world_a = make_world(1, schema)
    const world_b = make_world(2, schema)
    create_link(world_a, world_b)

    const parent = spawn(world_a, [Position({ x: 10, y: 10 }), Replicated])
    const child = spawn(world_a, [ChildOf(parent), Replicated])
    commit_transaction(world_a)

    // Verify relationship exists in world B
    const incoming = world_b.relations.object_to_subjects.get(parent)
    expect(incoming).toBeDefined()
    if (incoming) {
      expect(
        Array.from(incoming).some(
          (r) => r.subject === child && r.relation_id === world_b.component_registry.get_id(ChildOf),
        ),
      ).toBe(true)
    }
  })

  test("relationship removal replication", () => {
    const world_a = make_world(1, schema)
    const world_b = make_world(2, schema)
    create_link(world_a, world_b)

    const parent = spawn(world_a, [Position({ x: 10, y: 10 }), Replicated])
    const child = spawn(world_a, [ChildOf(parent), Replicated])
    commit_transaction(world_a)

    expect(world_b.relations.object_to_subjects.has(parent)).toBe(true)

    remove_component(world_a, child, ChildOf(parent))
    commit_transaction(world_a)

    expect(world_b.relations.object_to_subjects.has(parent)).toBe(false)
  })

  test("add_component replication", () => {
    const world_a = make_world(1, schema)
    const world_b = make_world(2, schema)
    create_link(world_a, world_b)

    const entity_a = spawn(world_a, [Position({ x: 10, y: 20 }), Replicated])
    add_component(world_a, entity_a, Velocity({ dx: 1, dy: 1 }))
    commit_transaction(world_a)

    const vel_b = get_component_value(world_b, entity_a, Velocity)
    expect(vel_b).toBeDefined()
    if (vel_b) {
      expect(vel_b.dx).toBe(1)
      expect(vel_b.dy).toBe(1)
    }
  })

  test("remove_component replication", () => {
    const world_a = make_world(1, schema)
    const world_b = make_world(2, schema)
    create_link(world_a, world_b)

    const entity_a = spawn(world_a, [
      Position({ x: 10, y: 20 }),
      Velocity({ dx: 1, dy: 1 }),
      Replicated,
    ])
    commit_transaction(world_a)
    expect(get_component_value(world_b, entity_a, Velocity)).toBeDefined()

    remove_component(world_a, entity_a, Velocity)
    commit_transaction(world_a)

    expect(get_component_value(world_b, entity_a, Velocity)).toBeUndefined()
    expect(get_component_value(world_b, entity_a, Position)).toBeDefined()
  })

  test("basic despawn replication", () => {
    const world_a = make_world(1, schema)
    const world_b = make_world(2, schema)
    create_link(world_a, world_b)

    const entity_a = spawn(world_a, [Position({ x: 10, y: 20 }), Replicated])
    commit_transaction(world_a)
    expect(get_component_value(world_b, entity_a, Position)).toBeDefined()

    despawn(world_a, entity_a)
    commit_transaction(world_a)
    expect(get_component_value(world_b, entity_a, Position)).toBeUndefined()
  })

  test("LWW conflict resolution (newer tick wins)", () => {
    const world_a = make_world(1, schema)
    const world_b = make_world(2, schema)
    create_link(world_a, world_b)

    // 1. Initial spawn in world A and replicate to B
    const entity = spawn(world_a, [Position({ x: 0, y: 0 }), Replicated])
    commit_transaction(world_a)

    // Manual transaction application to simulate race condition
    // Transaction 1: Tick 10 (Arrives second)
    const tx1: Transaction = {
      hi: 1,
      seq: get_domain(world_b.registry, 1).op_seq + 1,
      tick: 10,
      ops: [
        {
          type: "set",
          entity,
          component_id: world_b.component_registry.get_id(Position),
          data: { x: 10, y: 10 },
        },
      ],
    }

    // Transaction 2: Tick 20 (Arrives first)
    const tx2: Transaction = {
      hi: 1,
      seq: get_domain(world_b.registry, 1).op_seq,
      tick: 20,
      ops: [
        {
          type: "set",
          entity,
          component_id: world_b.component_registry.get_id(Position),
          data: { x: 20, y: 20 },
        },
      ],
    }

    apply_transaction(world_b, tx2)
    apply_transaction(world_b, tx1)

    const pos_b = get_component_value(world_b, entity, Position)
    if (pos_b) {
      expect(pos_b.x).toBe(20) // Tick 20 should win even if it arrived first
    }
  })

  test("P2P multi-agent replication", () => {
    const world_a = make_world(1, schema)
    const world_b = make_world(2, schema)

    // Bidirectional link
    create_link(world_a, world_b)
    create_link(world_b, world_a)

    const entity_a = spawn(world_a, [Position({ x: 1, y: 1 }), Replicated])
    const entityB = spawn(world_b, [Position({ x: 2, y: 2 }), Replicated])

    commit_transaction(world_a)
    commit_transaction(world_b)

    // World A should see B's entity
    const pos_a = get_component_value(world_a, entityB, Position)
    if (pos_a) {
      expect(pos_a.x).toBe(2)
    }
    // World B should see A's entity
    const pos_b_p2p = get_component_value(world_b, entity_a, Position)
    if (pos_b_p2p) {
      expect(pos_b_p2p.x).toBe(1)
    }
  })

  test("predictive shadowing and rebinding", () => {
    const world = make_world(1, schema) // Client domain
    const causal_key = 12345

    // 1. Client predicts a spawn in a "transient" domain
    const transientEntity = spawn(
      world,
      [Position({ x: 100, y: 100 }), Replicated],
      TRANSIENT_DOMAIN,
    )
    // The spawn() call above already registered it with a generated causal key.
    // For this manual test, we'll overwrite it with our specific causal_key.
    world.transient_registry.set(causal_key, {
      entity: transientEntity,
      tick: world.tick,
    })

    const pos_transient = get_component_value(world, transientEntity, Position)
    if (pos_transient) {
      expect(pos_transient.x).toBe(100)
    }

    // 2. Authoritative spawn arrives from server (hi=0) with the same causal key
    const serverEntity = ((0 << 20) | 500) as Entity // Manually create a server entity ID
    const tx: Transaction = {
      hi: 0,
      seq: 1,
      tick: 100,
      ops: [
        {
          type: "spawn",
          entity: serverEntity,
          causal_key: causal_key,
          components: [{ id: world.component_registry.get_id(Position), data: { x: 105, y: 105 } }],
        },
      ],
    }

    apply_transaction(world, tx)

    // 3. Verify rebinding
    // The transient ID should no longer have the component
    expect(
      get_component_value(world, transientEntity, Position),
    ).toBeUndefined()
    // The server ID should have the authoritative component
    const pos_server = get_component_value(world, serverEntity, Position)
    if (pos_server) {
      expect(pos_server.x).toBe(105)
    }

    // The transient registry mapping should persist for resimulation
    expect(world.transient_registry.has(causal_key)).toBe(true)
  })

  test("automatic causal key generation and rebinding", () => {
    const world_client = make_world(1, schema)
    const world_server = make_world(0, schema)

    // 1. Align ticks
    world_client.tick = 100
    world_server.tick = 100

    // 2. Client predicts a spawn in a "transient" domain
    // Spawning in any non-owned domain (hi !== world.hi) marks it as transient
    const predictedEntity = spawn(world_client, [Position({ x: 1, y: 1 }), Replicated], TRANSIENT_DOMAIN)
    expect(world_client.transient_registry.size).toBe(1)

    // 3. Server performs the "real" spawn at the same tick
    let serverTx: Transaction | undefined
    world_server.recorder = (tx) => (serverTx = tx)
    const authoritativeEntity = spawn(world_server, [
      Position({ x: 2, y: 2 }),
      Replicated,
    ])

    // Capture the server's transaction
    commit_transaction(world_server)

    expect(serverTx).toBeDefined()
    const op = serverTx?.ops[0]
    expect(op?.type).toBe("spawn")
    if (op?.type === "spawn") {
      expect(op.causal_key).toBeDefined()
    }

    // 4. Client receives server transaction and applies it
    if (serverTx) {
      apply_transaction(world_client, serverTx)
    }

    // 5. Verify rebinding
    // The predicted ID should be gone from graph/storage, authoritative should be there
    expect(
      get_component_value(world_client, predictedEntity, Position),
    ).toBeUndefined()
    const pos_authoritative = get_component_value(
      world_client,
      authoritativeEntity,
      Position,
    )
    if (pos_authoritative) {
      expect(pos_authoritative.x).toBe(2)
    }
    // Mapping persists for resimulation
    expect(world_client.transient_registry.size).toBe(1)
  })
})
