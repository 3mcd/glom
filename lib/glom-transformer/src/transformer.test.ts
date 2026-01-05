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
      const Position = g.define_component<{x: number; y: number}>()
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
      const Position = g.define_component<{x: number; y: number}>()
      const on_added = (added: g.In<g.Read<typeof Position>>) => {
        for (const [pos] of added) {
          console.log(pos)
        }
      }
    `
    const output = transform(input)
    expect(output).toContain("_q0_added = added.joins[0]")
    expect(output).toContain('Object.defineProperty(on_added, "__system_desc"')
    expect(output).toContain("params: [{ in: { all: [{ read: Position }] } }]")
  })

  test("transforms Out query", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Position = g.define_component<{x: number; y: number}>()
      const on_removed = (removed: g.Out<g.Read<typeof Position>>) => {
        for (const [pos] of removed) {
          console.log(pos)
        }
      }
    `
    const output = transform(input)
    expect(output).toContain("_q0_removed = removed.joins[0]")
    expect(output).toContain(
      'Object.defineProperty(on_removed, "__system_desc"',
    )
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
      type MyIn = g.In<g.Read<typeof Position>>
      const on_added = (added: MyIn) => {
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
      const Position = g.define_component<{x: number; y: number}>()
      const Velocity = g.define_component<{dx: number; dy: number}>()
      const move = (q1: g.All<g.Write<typeof Position>>, q2: g.All<g.Read<typeof Velocity>>) => {
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
      const Position = g.define_component<{x: number; y: number}>()
      const TargetOf = g.define_relation()
      const follow = (q: g.All<g.Write<typeof Position>, g.Rel<typeof TargetOf, g.Read<typeof Position>>>) => {
        for (const [pos, target_pos] of q) {
          pos.x = target_pos.x
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
})
