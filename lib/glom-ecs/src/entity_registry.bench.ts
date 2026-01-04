import {bench, group, run} from "mitata"
import {
  alloc_entity,
  make_entity_registry,
  remove_entity,
} from "./entity_registry"

group("entity_registry", () => {
  const entity_count = 10000
  const entities = new Array(entity_count)

  bench(`alloc ${entity_count} entities (single domain)`, () => {
    const registry = make_entity_registry(0)
    for (let i = 0; i < entity_count; i++) {
      entities[i] = alloc_entity(registry, 0)
    }
  })

  bench(`remove ${entity_count} entities (single domain)`, () => {
    const registry = make_entity_registry(0)
    for (let i = 0; i < entity_count; i++) {
      entities[i] = alloc_entity(registry, 0)
    }
    for (let i = 0; i < entity_count; i++) {
      remove_entity(registry, entities[i])
    }
  })

  bench(`alloc ${entity_count} entities (multi domain)`, () => {
    const registry = make_entity_registry(0)
    for (let i = 0; i < entity_count; i++) {
      entities[i] = alloc_entity(registry, i % 10)
    }
  })

  bench(`remove ${entity_count} entities (multi domain)`, () => {
    const registry = make_entity_registry(0)
    for (let i = 0; i < entity_count; i++) {
      entities[i] = alloc_entity(registry, i % 10)
    }
    for (let i = 0; i < entity_count; i++) {
      remove_entity(registry, entities[i])
    }
  })
})

await run()
