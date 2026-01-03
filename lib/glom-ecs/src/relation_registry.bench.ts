// biome-ignore-all lint/style/noNonNullAssertion: tests
import { bench, group, run } from "mitata"
import type { Entity } from "./entity"
import { define_relationship } from "./relation"
import {
  get_or_create_virtual_id,
  register_incoming_relation,
  unregister_incoming_relation,
} from "./relation_registry"
import { make_world } from "./world"

const relation_count = 100
const relations = Array.from({ length: relation_count }, (_, i) =>
  define_relationship(i),
)
const entity_count = 1000
const entities = Array.from({ length: entity_count }, (_, i) => i as Entity)
const world = make_world(0)

group("relation registry operations", () => {
  bench("get_or_create_virtual_id (new pairs)", () => {
    // Note: this will actually create them, so we might want to reset or use different world
    // but for a micro-bench, seeing the map lookup/insert cost is useful.
    for (let i = 0; i < relation_count; i++) {
      for (let j = 0; j < 10; j++) {
        get_or_create_virtual_id(world, relations[i]!, entities[j]!)
      }
    }
  })

  bench("get_or_create_virtual_id (existing pairs)", () => {
    for (let i = 0; i < relation_count; i++) {
      for (let j = 0; j < 10; j++) {
        get_or_create_virtual_id(world, relations[i]!, entities[j]!)
      }
    }
  })

  bench("register_incoming_relation", () => {
    for (let i = 0; i < 1000; i++) {
      const source = entities[i % entity_count]!
      const target = entities[(i + 1) % entity_count]!
      const rel = relations[i % relation_count]!
      register_incoming_relation(world, source, rel.id, target)
    }
  })

  bench("unregister_incoming_relation", () => {
    for (let i = 0; i < 1000; i++) {
      const source = entities[i % entity_count]!
      const target = entities[(i + 1) % entity_count]!
      const rel = relations[i % relation_count]!
      unregister_incoming_relation(world, source, rel.id, target)
    }
  })
})

await run()
