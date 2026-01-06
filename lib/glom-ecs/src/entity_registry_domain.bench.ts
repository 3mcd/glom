import {bench, group, run} from "mitata"
import {
  allocDomainEntity,
  makeEntityRegistryDomain,
  removeDomainEntity,
} from "./entity_registry_domain"

group("entityRegistryDomain", () => {
  const entityCount = 10000
  const entities = new Array(entityCount)

  bench(`alloc ${entityCount} entities`, () => {
    const domain = makeEntityRegistryDomain(0)
    for (let i = 0; i < entityCount; i++) {
      entities[i] = allocDomainEntity(domain)
    }
  })

  bench(`remove ${entityCount} entities`, () => {
    const domain = makeEntityRegistryDomain(0)
    for (let i = 0; i < entityCount; i++) {
      entities[i] = allocDomainEntity(domain)
    }

    for (let i = 0; i < entityCount; i++) {
      removeDomainEntity(domain, entities[i])
    }
  })
})

await run()
