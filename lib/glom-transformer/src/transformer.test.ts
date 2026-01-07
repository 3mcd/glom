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

  test("transforms Join query", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Position = g.defineComponent<{x: number; y: number}>()
      const TargetOf = g.defineRelation()
      const follow = (q: g.Join<g.All<g.Write<typeof Position>>, g.All<typeof Position>, typeof TargetOf>) => {
        for (const [pos, targetPos] of q) {
          pos.x = targetPos.x
        }
      }
    `
    const output = transform(input)
    expect(output).toContain("_q0_q = q.joins[0]")
    expect(output).toContain("_q1_q = q.joins[1]")
    expect(output).toContain(
      "params: [{ join: [{ all: [{ write: Position }] }, { all: [{ read: Position }] }, TargetOf] }]",
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

  test("transforms Join query (Cartesian product)", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Position = g.defineComponent<{x: number; y: number}>()
      const Name = g.defineComponent<string>()
      const system = (q: g.Join<g.All<typeof Position>, g.All<typeof Name>>) => {
        for (const [pos, name] of q) {
          console.log(pos, name)
        }
      }
    `
    const output = transform(input)
    expect(output).toContain("_q0_q = q.joins[0]")
    expect(output).toContain("_q1_q = q.joins[1]")
    expect(output).toContain(
      "params: [{ join: [{ all: [{ read: Position }] }, { all: [{ read: Name }] }, undefined] }]",
    )
    expect(output).toContain("joinOn")
  })

  test("transforms Join query (with relation)", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Position = g.defineComponent<{x: number; y: number}>()
      const Name = g.defineComponent<string>()
      const ChildOf = g.defineRelation()
      const system = (q: g.Join<g.All<typeof Position>, g.All<typeof Name>, typeof ChildOf>) => {
        for (const [pos, name] of q) {
          console.log(pos, name)
        }
      }
    `
    const output = transform(input)
    expect(output).toContain("_q0_q = q.joins[0]")
    expect(output).toContain("_q1_q = q.joins[1]")
    expect(output).toContain(
      "params: [{ join: [{ all: [{ read: Position }] }, { all: [{ read: Name }] }, ChildOf] }]",
    )
    expect(output).toContain("joinOn")
  })

  test("transforms Join query (partial In)", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Position = g.defineComponent<{x: number; y: number}>()
      const Name = g.defineComponent<string>()
      const ChildOf = g.defineRelation()
      const system = (q: g.Join<g.In<typeof Position>, g.All<typeof Name>, typeof ChildOf>) => {
        for (const [pos, name] of q) {
          console.log(pos, name)
        }
      }
    `
    const output = transform(input)
    expect(output).toContain("_q0_q = q.joins[0]")
    expect(output).toContain("_q1_q = q.joins[1]")
    expect(output).toContain(
      "params: [{ join: [{ in: { all: [{ read: Position }] } }, { all: [{ read: Name }] }, ChildOf] }]",
    )
  })

  test("transforms In wrapping Join query", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Position = g.defineComponent<{x: number; y: number}>()
      const Name = g.defineComponent<string>()
      const ChildOf = g.defineRelation()
      const system = (added: g.In<g.Join<g.All<typeof Position>, g.All<typeof Name>, typeof ChildOf>>) => {
        for (const [pos, name] of added) {
          console.log(pos, name)
        }
      }
    `
    const output = transform(input)
    expect(output).toContain("_q0_added = added.joins[0]")
    expect(output).toContain("_q1_added = added.joins[1]")
    expect(output).toContain(
      "params: [{ in: { join: [{ all: [{ read: Position }] }, { all: [{ read: Name }] }, ChildOf] } }]",
    )
  })

  test("transforms movementSystem from canvas example", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Position = g.defineComponent<{x: number; y: number}>()
      const MoveCommand = g.defineComponent<{dx: number; dy: number}>()
      const SPEED = 1;
      const movementSystem = (
        query: g.Join<
          g.All<g.Entity, typeof Position>,
          g.All<typeof MoveCommand>,
          typeof g.CommandOf
        >,
        update: g.Add<typeof Position>,
      ) => {
        for (const [entity, pos, move] of query) {
          let nextX = pos.x + move.dx * SPEED
          update(entity, {x: nextX, y: pos.y})
        }
      }
    `
    const output = transform(input)
    expect(output).toContain("_q0_query = query.joins[0]")
    expect(output).toContain("_q1_query = query.joins[1]")
    expect(output).toContain("const pos = _store")
    expect(output).toContain("const move = _store")
    expect(output).toContain("params: [{ join: [")
  })

  test("transforms aliased movementSystem from canvas example", () => {
    const input = `
      namespace g {
        export type All<T0, T1=any, T2=any, T3=any, T4=any, T5=any, T6=any, T7=any> = { __all: true };
        export type Join<L, R, Rel=undefined> = { __join: true };
        export type Entity = { entity: true };
        export type Add<T> = { add: T };
        export const defineComponent = <T>() => ({ __component_brand: true } as any);
        export const CommandOf = { __component_brand: true } as any;
      }
      const Position = g.defineComponent<{x: number; y: number}>()
      const MoveCommand = g.defineComponent<{dx: number; dy: number}>()
      type Query = g.Join<
        g.All<g.Entity, typeof Position>,
        g.All<typeof MoveCommand>,
        typeof g.CommandOf
      >;
      const SPEED = 1;
      const movementSystem = (
        query: Query,
        update: g.Add<typeof Position>,
      ) => {
        for (const [entity, pos, move] of query) {
          let nextX = pos.x + move.dx * SPEED
          update(entity, {x: nextX, y: pos.y})
        }
      }
    `
    const output = transform(input)
    expect(output).toContain("_q0_query = query.joins[0]")
    expect(output).toContain("_q1_query = query.joins[1]")
    expect(output).toContain("const pos = _store")
    expect(output).toContain("const move = _store")
    expect(output).toContain("g.CommandOf")
    expect(output).toContain("params: [{ join: [")
  })

  test("transforms doubly aliased Join query", () => {
    const input = `
      namespace g {
        export type All<T0, T1=any, T2=any, T3=any, T4=any, T5=any, T6=any, T7=any> = { __all: true };
        export type Join<L, R, Rel=undefined> = { __join: true };
        export const defineComponent = <T>() => ({ __component_brand: true } as any);
      }
      const Pos = g.defineComponent<{x: number}>();
      type PosAll = g.All<typeof Pos>;
      type BaseQuery = g.Join<PosAll, PosAll>;
      type FinalQuery = BaseQuery;
      
      const system = (q: FinalQuery) => {
        for (const [p1, p2] of q) {
          console.log(p1, p2);
        }
      };
    `
    const output = transform(input)
    expect(output).toContain("_q0_q = q.joins[0]")
    expect(output).toContain("_q1_q = q.joins[1]")
    expect(output).toContain(
      "params: [{ join: [{ all: [{ read: Pos }] }, { all: [{ read: Pos }] }, undefined] }]",
    )
  })
})
