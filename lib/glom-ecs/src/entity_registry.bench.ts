import {bench, group, run} from "mitata"
import {
  allocEntity,
  makeEntityRegistry,
  removeEntity,
} from "./entity_registry"

group("entityRegistry", () => {
  const entityCount = 10000
  const entities = new Array(entityCount)

  bench(`alloc ${entityCount} entities (single domain)`, () => {
    const registry = makeEntityRegistry(0)
    for (let i = 0; i < entityCount; i++) {
      entities[i] = allocEntity(registry, 0)
    }
  })

  bench(`remove ${entityCount} entities (single domain)`, () => {
    const registry = makeEntityRegistry(0)
    for (let i = 0; i < entityCount; i++) {
      entities[i] = allocEntity(registry, 0)
    }
    for (let i = 0; i < entityCount; i++) {
      removeEntity(registry, entities[i])
    }
  })

  bench(`alloc ${entityCount} entities (multi domain)`, () => {
    const registry = makeEntityRegistry(0)
    for (let i = 0; i < entityCount; i++) {
      entities[i] = allocEntity(registry, i % 10)
    }
  })

  bench(`remove ${entityCount} entities (multi domain)`, () => {
    const registry = makeEntityRegistry(0)
    for (let i = 0; i < entityCount; i++) {
      entities[i] = allocEntity(registry, i % 10)
    }
    for (let i = 0; i < entityCount; i++) {
      removeEntity(registry, entities[i])
    }
  })
})

await run()
