import {describe, expect, test} from "bun:test"
import ts from "typescript"
import {createTransformer} from "./transformer"

function transform(code: string): string {
  const sourceFile = ts.createSourceFile(
    "test.ts",
    code,
    ts.ScriptTarget.Latest,
    true,
  )

  const program = ts.createProgram({
    rootNames: ["test.ts"],
    options: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.Latest,
      skipLibCheck: true,
    },
    host: {
      ...ts.createCompilerHost({}),
      getSourceFile: (fileName) =>
        fileName === "test.ts" ? sourceFile : undefined,
      readFile: (fileName) => (fileName === "test.ts" ? code : undefined),
      fileExists: (fileName) => fileName === "test.ts",
    },
  })

  const transformer = createTransformer(program)
  const result = ts.transform(sourceFile, [transformer])
  const printer = ts.createPrinter()
  return printer.printFile(result.transformed[0])
}

describe("transformer", () => {
  test("transforms simple All query", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Position = g.defineComponent<{x: number; y: number}>()
      const move = (q: g.All<g.Write<typeof Position>>) => {
        for (const [pos] of q) {
          pos.x += 1
        }
      }
    `
    const output = transform(input)
    expect(output).toContain("_q0_q = q.joins[0]")
    expect(output).toContain('Object.defineProperty(move, "__system_desc"')
    expect(output).toContain("params: [{ all: [{ write: Position }] }]")
  })

  test("transforms In query", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Position = g.defineComponent<{x: number; y: number}>()
      const onAdded = (added: g.In<typeof Position>) => {
        for (const [pos] of added) {
          console.log(pos)
        }
      }
    `
    const output = transform(input)
    expect(output).toContain("_q0_added = added.joins[0]")
    expect(output).toContain('Object.defineProperty(onAdded, "__system_desc"')
    expect(output).toContain("params: [{ in: { all: [{ read: Position }] } }]")
  })

  test("transforms Out query", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Position = g.defineComponent<{x: number; y: number}>()
      const onRemoved = (removed: g.Out<typeof Position>) => {
        for (const [pos] of removed) {
          console.log(pos)
        }
      }
    `
    const output = transform(input)
    expect(output).toContain("_q0_removed = removed.joins[0]")
    expect(output).toContain('Object.defineProperty(onRemoved, "__system_desc"')
    expect(output).toContain("params: [{ out: { all: [{ read: Position }] } }]")
  })

  test("transforms aliased All query", () => {
    const input = `
      namespace g {
        export type All<T0, T1=any, T2=any, T3=any, T4=any, T5=any, T6=any, T7=any> = { __all: true };
        export type Write<T> = { __write: T };
      }
      const Position = { __component_brand: true };
      type MyAll = g.All<g.Write<typeof Position>>
      const move = (q: MyAll) => {
        for (const [pos] of q) {
          pos.x += 1
        }
      }
    `
    const output = transform(input)
    expect(output).toContain("_q0_q = q.joins[0]")
    expect(output).toContain("params: [{ all: [{ write: Position }] }]")
  })

  test("transforms aliased In query", () => {
    const input = `
      namespace g {
        export type In<T0, T1=any, T2=any, T3=any, T4=any, T5=any, T6=any, T7=any> = { __all: true; __in: true };
        export type Read<T> = { __read: T };
      }
      const Position = { __component_brand: true };
      type MyIn = g.In<typeof Position>
      const onAdded = (added: MyIn) => {
        for (const [pos] of added) {
          console.log(pos)
        }
      }
    `
    const output = transform(input)
    expect(output).toContain("_q0_added = added.joins[0]")
    expect(output).toContain("params: [{ in: { all: [{ read: Position }] } }]")
  })

  test("transforms multiple queries in one system", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Position = g.defineComponent<{x: number; y: number}>()
      const Velocity = g.defineComponent<{dx: number; dy: number}>()
      const move = (q1: g.All<g.Write<typeof Position>>, q2: g.All<typeof Velocity>) => {
        for (const [pos] of q1) {
          for (const [vel] of q2) {
            pos.x += vel.dx
          }
        }
      }
    `
    const output = transform(input)
    expect(output).toContain("_q0_q1 = q1.joins[0]")
    expect(output).toContain("_q0_q2 = q2.joins[0]")
    expect(output).toContain(
      "params: [{ all: [{ write: Position }] }, { all: [{ read: Velocity }] }]",
    )
  })

  test("transforms Rel join query", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Position = g.defineComponent<{x: number; y: number}>()
      const TargetOf = g.defineRelation()
      const follow = (q: g.All<g.Write<typeof Position>, g.Rel<typeof TargetOf, typeof Position>>) => {
        for (const [pos, targetPos] of q) {
          pos.x = targetPos.x
        }
      }
    `
    const output = transform(input)
    expect(output).toContain("_q0_q = q.joins[0]")
    expect(output).toContain("_q1_q = q.joins[1]")
    expect(output).toContain(
      "params: [{ all: [{ write: Position }, { rel: [TargetOf, { read: Position }] }] }]",
    )
  })

  test("transforms function declaration", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Position = g.defineComponent<{x: number; y: number}>()
      function move(q: g.All<g.Write<typeof Position>>) {
        for (const [pos] of q) {
          pos.x += 1
        }
      }
    `
    const output = transform(input)
    expect(output).toContain("_q0_q = q.joins[0]")
    expect(output).toContain('Object.defineProperty(move, "__system_desc"')
    expect(output).toContain("params: [{ all: [{ write: Position }] }]")
  })

  test("transforms anonymous arrow function (wrapWithMetadata)", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Position = g.defineComponent<{x: number; y: number}>()
      const schedule = {} as any
      g.addSystem(schedule, (q: g.All<g.Write<typeof Position>>) => {
        for (const [pos] of q) {
          pos.x += 1
        }
      })
    `
    const output = transform(input)
    expect(output).toContain("Object.defineProperty((q")
    expect(output).toContain('"__system_desc"')
    expect(output).toContain("params: [{ all: [{ write: Position }] }]")
  })

  test("transforms Has, Not, and Entity terms", () => {
    const input = `
      import * as g from "@glom/ecs"
      const A = g.defineComponent<{}>()
      const B = g.defineComponent<{}>()
      const system = (q: g.All<g.Entity, g.Has<typeof A>, g.Not<typeof B>>) => {
        for (const [entity] of q) {
          console.log(entity)
        }
      }
    `
    const output = transform(input)
    expect(output).toContain(
      "params: [{ all: [{ entity: true }, { has: A }, { not: B }] }]",
    )
  })

  test("transforms Add, Remove, Spawn, Despawn, and World parameters", () => {
    const input = `
      import * as g from "@glom/ecs"
      const A = g.defineComponent<{}>()
      const system = (
        world: g.World,
        add: g.Add<typeof A>,
        remove: g.Remove<typeof A>,
        spawn: g.Spawn,
        despawn: g.Despawn,
        has: g.Has<typeof A>,
        not: g.Not<typeof A>,
        read: g.Read<typeof A>,
        write: g.Write<typeof A>
      ) => {}
    `
    const output = transform(input)
    expect(output).toContain("world: true")
    expect(output).toContain("add: A")
    expect(output).toContain("remove: A")
    expect(output).toContain("spawn: true")
    expect(output).toContain("despawn: true")
    expect(output).toContain("has: A")
    expect(output).toContain("not: A")
    expect(output).toContain("read: A")
    expect(output).toContain("write: A")
  })

  test("transforms unboxed component (implicit Read)", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Position = g.defineComponent<{x: number; y: number}>()
      const move = (q: g.All<typeof Position>) => {
        for (const [pos] of q) {
          pos.x += 1
        }
      }
    `
    const output = transform(input)
    expect(output).toContain("_q0_q = q.joins[0]")
    expect(output).toContain("params: [{ all: [{ read: Position }] }]")
  })

  test("transforms unboxed component in system parameter", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Position = g.defineComponent<{x: number; y: number}>()
      const mySystem = (pos: typeof Position) => {}
    `
    const output = transform(input)
    expect(output).toContain("params: [{ read: Position }]")
  })

  test("transforms Unique query parameter", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Position = g.defineComponent<{x: number; y: number}>()
      const mySystem = (pos: g.Unique<typeof Position>) => {
        console.log(pos.x)
      }
    `
    const output = transform(input)
    expect(output).toContain(".get()")
    expect(output).toContain("params: [{ unique: [{ read: Position }] }]")
  })

  test("transforms Unique query parameter with destructuring", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Position = g.defineComponent<{x: number; y: number}>()
      const mySystem = ([pos]: g.Unique<typeof Position>) => {
        console.log(pos.x)
      }
    `
    const output = transform(input)
    expect(output).toContain("const [pos] = _unique_query_1.get()")
    expect(output).toContain("params: [{ unique: [{ read: Position }] }]")
  })

  test("transforms aliased World", () => {
    const input = `
      namespace g {
        export type World = { __world: true };
      }
      type W = g.World;
      const system = (world: W) => {}
    `
    const output = transform(input)
    expect(output).toContain("world: true")
  })
})
