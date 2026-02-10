import {describe, expect, test} from "bun:test"
import {defineComponent} from "./component"
import type {Entity} from "./entity"
import {
  type EntityGraphNode,
  emitMovedEntities,
  emitSpawnedEntities,
  entityGraphBatchAdd,
  entityGraphFindOrCreateNode,
  entityGraphGetEntityNode,
  entityGraphNodeAddListener,
  entityGraphNodeHasEntity,
  entityGraphNodePrune,
  entityGraphSetEntityNode,
  makeEntityGraph,
  makeEntityGraphBatch,
  makeEntityGraphNode,
  PruneStrategy,
} from "./entity_graph"
import {makeComponentRegistry} from "./registry"
import {makeVec, makeVecSorted} from "./vec"

describe("entityGraph", () => {
  const c1 = defineComponent("c1")
  const c2 = defineComponent("c2")
  const c3 = defineComponent("c3")
  const registry = makeComponentRegistry([c1, c2, c3])
  const emptyVec = makeVecSorted([], registry)

  const v1 = makeVec([c1], registry)
  const v12 = makeVec([c1, c2], registry)
  const v123 = makeVec([c1, c2, c3], registry)

  test("makeEntityGraph", () => {
    const graph = makeEntityGraph(registry)
    expect(graph.root).toBeDefined()
    expect(graph.root.id).toBe(0)
    expect(graph.nextId).toBe(1)
  })

  test("findOrCreateNode", () => {
    const graph = makeEntityGraph(registry)
    const node1 = entityGraphFindOrCreateNode(graph, v1)
    const node2 = entityGraphFindOrCreateNode(graph, v1)

    expect(node1).toBe(node2)
    expect(node1.id).toBe(1)
    expect(graph.nextId).toBe(2)
  })

  test("linking logic (subset/superset)", () => {
    const graph = makeEntityGraph(registry)
    const n1 = entityGraphFindOrCreateNode(graph, v1)
    const n12 = entityGraphFindOrCreateNode(graph, v12)

    expect(n1.nextNodes.dense).toContain(n12)
    expect(n12.prevNodes.dense).toContain(n1)

    const n123 = entityGraphFindOrCreateNode(graph, v123)
    expect(n12.nextNodes.dense).toContain(n123)
    expect(n123.prevNodes.dense).toContain(n12)
    expect(n1.nextNodes.dense).not.toContain(n123)
  })

  test("setEntityNode", () => {
    const graph = makeEntityGraph(registry)
    const n1 = entityGraphFindOrCreateNode(graph, v1)
    const entity = 100 as Entity

    entityGraphSetEntityNode(graph, entity, n1, entity as unknown as number)
    expect(entityGraphGetEntityNode(graph, entity)).toBe(n1)
    expect(entityGraphNodeHasEntity(n1, entity)).toBe(true)

    const n12 = entityGraphFindOrCreateNode(graph, v12)
    entityGraphSetEntityNode(graph, entity, n12, entity as unknown as number)
    expect(entityGraphGetEntityNode(graph, entity)).toBe(n12)
    expect(entityGraphNodeHasEntity(n1, entity)).toBe(false)
    expect(entityGraphNodeHasEntity(n12, entity)).toBe(true)
  })

  test("listeners and emitSpawnedEntities", () => {
    const graph = makeEntityGraph(registry)
    const n1 = entityGraphFindOrCreateNode(graph, v1)

    const spawned: Entity[] = []
    entityGraphNodeAddListener(n1, {
      entitiesIn: (entities) => {
        spawned.push(...entities)
      },
    })

    const batch = makeEntityGraphBatch(undefined, n1)
    entityGraphBatchAdd(batch, 1 as Entity)
    entityGraphBatchAdd(batch, 2 as Entity)

    emitSpawnedEntities(batch)
    expect(spawned).toEqual([1 as Entity, 2 as Entity])
  })

  test("emitMovedEntities", () => {
    const graph = makeEntityGraph(registry)
    const n1 = entityGraphFindOrCreateNode(graph, v1)
    const n12 = entityGraphFindOrCreateNode(graph, v12)

    const movedIn: Entity[] = []
    const movedOut: Entity[] = []

    entityGraphNodeAddListener(n12, {
      entitiesIn: (entities) => movedIn.push(...entities),
      entitiesOut: (entities) => movedOut.push(...entities),
    })

    const batch1 = makeEntityGraphBatch(graph.root, n12)
    entityGraphBatchAdd(batch1, 1 as Entity)
    emitMovedEntities(batch1, registry)
    expect(movedIn).toEqual([1 as Entity])

    movedIn.length = 0
    const batch2 = makeEntityGraphBatch(n12, n1)
    entityGraphBatchAdd(batch2, 1 as Entity)
    emitMovedEntities(batch2, registry)
    expect(movedOut).toEqual([1 as Entity])
  })

  test("node pruning when empty", () => {
    const graph = makeEntityGraph(registry)
    const n1 = entityGraphFindOrCreateNode(graph, v1, PruneStrategy.WhenEmpty)
    const entity = 1 as Entity

    entityGraphSetEntityNode(graph, entity, n1, entity as unknown as number)
    expect(graph.byHash.has(v1.hash)).toBe(true)

    entityGraphSetEntityNode(
      graph,
      entity,
      graph.root,
      entity as unknown as number,
    )
    entityGraphNodePrune(graph, n1)
    expect(graph.byHash.has(v1.hash)).toBe(false)
  })

  test("neighbor reconnection after pruning", () => {
    const graph = makeEntityGraph(registry)
    const n1 = entityGraphFindOrCreateNode(graph, v1)
    const n12 = entityGraphFindOrCreateNode(graph, v12, PruneStrategy.WhenEmpty)
    const n123 = entityGraphFindOrCreateNode(graph, v123)

    expect(n1.nextNodes.dense).toContain(n12)
    expect(n123.prevNodes.dense).toContain(n12)

    const entity = 1 as Entity
    entityGraphSetEntityNode(graph, entity, n12, entity as unknown as number)

    entityGraphSetEntityNode(
      graph,
      entity,
      graph.root,
      entity as unknown as number,
    )
    entityGraphNodePrune(graph, n12)

    expect(graph.byHash.has(v12.hash)).toBe(false)

    expect(n1.nextNodes.dense).toContain(n123)
    expect(n123.prevNodes.dense).toContain(n1)
  })

  test("root node is never pruned", () => {
    const graph = makeEntityGraph(registry)

    ;(graph.root as {strategy: PruneStrategy}).strategy =
      PruneStrategy.WhenEmpty

    const entity = 1 as Entity
    entityGraphSetEntityNode(
      graph,
      entity,
      graph.root,
      entity as unknown as number,
    )
    entityGraphSetEntityNode(
      graph,
      entity,
      makeEntityGraphNode(99, v1),
      entity as unknown as number,
    )

    expect(graph.byHash.has(emptyVec.hash)).toBe(true)
  })

  test("nodeDestroyed callback when pruned", () => {
    const graph = makeEntityGraph(registry)
    const n1 = entityGraphFindOrCreateNode(graph, v1, PruneStrategy.WhenEmpty)
    const entity = 1 as Entity

    let destroyedNode: EntityGraphNode | null = null
    entityGraphNodeAddListener(graph.root, {
      nodeDestroyed: (node) => {
        destroyedNode = node
      },
    })

    entityGraphSetEntityNode(graph, entity, n1, entity as unknown as number)
    entityGraphSetEntityNode(
      graph,
      entity,
      graph.root,
      entity as unknown as number,
    )
    entityGraphNodePrune(graph, n1)

    expect(destroyedNode as any).toBe(n1)
  })
})
