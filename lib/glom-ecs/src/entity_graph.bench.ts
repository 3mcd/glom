import {bench, group, run} from "mitata"
import {defineComponent} from "./component"
import type {Entity} from "./entity"
import {
  type EntityGraphNode,
  entityGraphFindOrCreateNode,
  entityGraphNodeTraverseLeft,
  entityGraphNodeTraverseRight,
  entityGraphSetEntityNode,
  makeEntityGraph,
} from "./entity_graph"
import {makeVec} from "./vec"

import {makeComponentRegistry} from "./registry"

const componentCount = 200
const components = Array.from({length: componentCount}, () => defineComponent())
const componentRegistry = makeComponentRegistry({local: components})
const nodeCount = 100
const nodes: EntityGraphNode[] = []
const entityCount = 10000
const entityGraph = makeEntityGraph(componentRegistry)

for (let i = 0; i < nodeCount; i++) {
  const nodeComponents = []
  const count = 3 + Math.floor(Math.random() * 6)
  for (let j = 0; j < count; j++) {
    nodeComponents.push(components[Math.floor(Math.random() * componentCount)]!)
  }
  nodes.push(
    entityGraphFindOrCreateNode(
      entityGraph,
      makeVec(nodeComponents, componentRegistry),
    ),
  )
}

const entities = Array.from({length: entityCount}, (_, i) => i as Entity)

group("entity operations", () => {
  bench("add 10,000 entities to random nodes", () => {
    for (let i = 0; i < entityCount; i++) {
      const node = nodes[i % nodes.length]!
      entityGraphSetEntityNode(entityGraph, entities[i]!, node, i)
    }
  })

  bench("move 10,000 entities to different nodes", () => {
    for (let i = 0; i < entityCount; i++) {
      const node = nodes[(i + 1) % nodes.length]!
      entityGraphSetEntityNode(entityGraph, entities[i]!, node, i)
    }
  })

  bench("remove 10,000 entities (move to root)", () => {
    for (let i = 0; i < entityCount; i++) {
      entityGraphSetEntityNode(entityGraph, entities[i]!, entityGraph.root, i)
    }
  })
})

group("graph traversals", () => {
  bench("traverse right (from root)", () => {
    entityGraphNodeTraverseRight(entityGraph.root, () => {})
  })

  const leafNode = nodes[nodes.length - 1]!
  bench("traverse left (from leaf)", () => {
    entityGraphNodeTraverseLeft(leafNode, () => {})
  })
})

await run()
