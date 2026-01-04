// biome-ignore-all lint/style/noNonNullAssertion: tests
import {bench, group, run} from "mitata"
import {define_component} from "./component"
import type {Entity} from "./entity"
import {
  type EntityGraphNode,
  entity_graph_find_or_create_node,
  entity_graph_node_traverse_left,
  entity_graph_node_traverse_right,
  entity_graph_set_entity_node,
  make_entity_graph,
} from "./entity_graph"
import {make_vec} from "./vec"

const component_count = 200
const components = Array.from({length: component_count}, (_, i) =>
  define_component(i),
)
const node_count = 100
const nodes: EntityGraphNode[] = []
const entity_count = 10000
const entity_graph = make_entity_graph()

for (let i = 0; i < node_count; i++) {
  const node_components = []
  const count = 3 + Math.floor(Math.random() * 6)
  for (let j = 0; j < count; j++) {
    node_components.push(
      components[Math.floor(Math.random() * component_count)]!,
    )
  }
  nodes.push(
    entity_graph_find_or_create_node(entity_graph, make_vec(node_components)),
  )
}

const entities = Array.from({length: entity_count}, (_, i) => i as Entity)

group("entity operations", () => {
  bench("add 10,000 entities to random nodes", () => {
    for (let i = 0; i < entity_count; i++) {
      const node = nodes[i % nodes.length]!
      entity_graph_set_entity_node(entity_graph, entities[i]!, node)
    }
  })

  bench("move 10,000 entities to different nodes", () => {
    for (let i = 0; i < entity_count; i++) {
      const node = nodes[(i + 1) % nodes.length]!
      entity_graph_set_entity_node(entity_graph, entities[i]!, node)
    }
  })

  bench("remove 10,000 entities (move to root)", () => {
    for (let i = 0; i < entity_count; i++) {
      entity_graph_set_entity_node(
        entity_graph,
        entities[i]!,
        entity_graph.root,
      )
    }
  })
})

group("graph traversals", () => {
  bench("traverse right (from root)", () => {
    entity_graph_node_traverse_right(entity_graph.root, () => {})
  })

  const leaf_node = nodes[nodes.length - 1]!
  bench("traverse left (from leaf)", () => {
    entity_graph_node_traverse_left(leaf_node, () => {})
  })
})

await run()
