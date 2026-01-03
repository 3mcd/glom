import * as g from "@glom/ecs"

const A = g.define_component<number>(0)
const B = g.define_component<string>(1)
const C = g.define_component<{ x: number }>(2)
const D = g.define_tag(3)
const Rel = g.define_relation(4)

const system_schedule = g.make_system_schedule()
const system = g.define_system(
  (
    query: g.All<
      g.Entity,
      g.Read<typeof A>,
      g.Rel<typeof Rel, typeof B>,
      g.Has<typeof D>
    >,
    c: g.Write<typeof C>,
  ) => {
    for (const [e, a, b] of query) {
      console.log(e, a, b)
    }
    c.x += 1
    console.log(c.x)
  },
  {
    params: [
      g.All(g.Entity, g.Read(A), g.Rel(Rel, g.Write(B)), g.Has(D)),
      g.Write(C),
    ],
  },
)

g.add_system(system_schedule, system)

const world = g.make_world(1)

const parent = g.spawn(world, [B("parent"), A(10)], 2)
g.spawn(world, [A(1), D, Rel(parent)], 1)

g.add_resource(world, C({ x: 1 }))
g.run_schedule(system_schedule, world)
