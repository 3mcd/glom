import {bench, group, run} from "mitata"
import type {Entity} from "./entity"
import {defineRelation} from "./relation"
import {
  getOrCreateVirtualId,
  registerIncomingRelation,
  unregisterIncomingRelation,
} from "./relation_registry"
import {makeWorld} from "./world"

const relationCount = 100
const relations = Array.from({length: relationCount}, (_, i) =>
  defineRelation(i),
)
const entityCount = 1000
const entities = Array.from({length: entityCount}, (_, i) => i as Entity)
const world = makeWorld({domainId: 0})

group("relation registry operations", () => {
  bench("getOrCreateVirtualId (new pairs)", () => {
    for (let i = 0; i < relationCount; i++) {
      for (let j = 0; j < 10; j++) {
        getOrCreateVirtualId(world, relations[i]!, entities[j]!)
      }
    }
  })

  bench("getOrCreateVirtualId (existing pairs)", () => {
    for (let i = 0; i < relationCount; i++) {
      for (let j = 0; j < 10; j++) {
        getOrCreateVirtualId(world, relations[i]!, entities[j]!)
      }
    }
  })

  bench("registerIncomingRelation", () => {
    for (let i = 0; i < 1000; i++) {
      const subject = entities[i % entityCount]!
      const object = entities[(i + 1) % entityCount]!
      const rel = relations[i % relationCount]!
      registerIncomingRelation(world, subject, rel.id as number, object)
    }
  })

  bench("unregisterIncomingRelation", () => {
    for (let i = 0; i < 1000; i++) {
      const subject = entities[i % entityCount]!
      const object = entities[(i + 1) % entityCount]!
      const rel = relations[i % relationCount]!
      unregisterIncomingRelation(world, subject, rel.id as number, object)
    }
  })
})

await run()
