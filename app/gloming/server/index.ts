import * as g from "@glom/ecs"

const A = g.define_component<number>(0)
const B = g.define_component<string>(1)
const C = g.define_component<{ x: number }>(2)

const system_schedule = g.make_system_schedule()
const system = (
  query: g.All<g.Entity, g.Write<typeof B>, g.Read<typeof A>>,
  c: g.Read<typeof C>,
) => {
  for (const [e, b, a] of query) {
    console.log(e, b, a)
  }
  console.log(c)
}

g.define_system(system, {
  params: [{ all: [g.ENTITY, { write: B }, { read: A }] }, { read: C }],
})

g.add_system(system_schedule, system)

const world = g.make_world(1)
// These should not be necessary because B and A are not resources but All query terms
// g.add_resource(world, A(1))
// g.add_resource(world, B("hello"))
g.add_resource(world, C({ x: 1 }))

g.run_system_schedule(system_schedule, world)
