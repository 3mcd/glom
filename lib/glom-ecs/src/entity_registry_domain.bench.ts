import { bench, group, run } from "mitata"
import {
  alloc_domain_entity,
  make_entity_registry_domain,
  remove_domain_entity,
} from "./entity_registry_domain"

group("entity_registry_domain", () => {
  const entity_count = 10000
  const entities = new Array(entity_count)

  bench(`alloc ${entity_count} entities`, () => {
    const domain = make_entity_registry_domain(0)
    for (let i = 0; i < entity_count; i++) {
      entities[i] = alloc_domain_entity(domain)
    }
  })

  bench(`remove ${entity_count} entities`, () => {
    const domain = make_entity_registry_domain(0)
    for (let i = 0; i < entity_count; i++) {
      entities[i] = alloc_domain_entity(domain)
    }
    // Now benchmark the removal
    for (let i = 0; i < entity_count; i++) {
      remove_domain_entity(domain, entities[i])
    }
  })
})

await run()
