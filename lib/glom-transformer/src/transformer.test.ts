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
      const Position = g.defineComponent<{x: number; y: number}>("Position")
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
      const Position = g.defineComponent<{x: number; y: number}>("Position")
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
      const Position = g.defineComponent<{x: number; y: number}>("Position")
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
      const Position = g.defineComponent<{x: number; y: number}>("Position")
      const Velocity = g.defineComponent<{dx: number; dy: number}>("Velocity")
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
      const Position = g.defineComponent<{x: number; y: number}>("Position")
      const TargetOf = g.defineRelation("TargetOf")
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

  test("transforms Join query with correct variable bindings", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Position = g.defineComponent<{x: number; y: number}>("Position")
      const MoveCommand = g.defineComponent<{dx: number; dy: number}>("MoveCommand")
      const CommandOf = g.defineRelation("CommandOf")
      const movementSystem = (q: g.Join<g.All<g.Write<typeof Position>>, g.All<typeof MoveCommand>, typeof CommandOf>) => {
        for (const [pos, move] of q) {
          pos.x += move.dx
        }
      }
    `
    const output = transform(input)
    // Both stores should be generated
    expect(output).toContain("_store0_q = q.stores[0]")
    expect(output).toContain("_store1_q = q.stores[1]")
    // pos should come from _e0 (left side, join index 0)
    expect(output).toContain("const pos = _store0_q[")
    expect(output).toMatch(/const pos = _store0_q\[_idx0_q\]/)
    // move should come from _e1 (right side, join index 1)
    expect(output).toContain("const move = _store1_q[")
    expect(output).toMatch(/const move = _store1_q\[.*_e1_q/)
  })

  test("transforms function declaration", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Position = g.defineComponent<{x: number; y: number}>("Position")
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
      const Position = g.defineComponent<{x: number; y: number}>("Position")
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
      const A = g.defineComponent<{}>("A")
      const B = g.defineComponent<{}>("B")
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
      const A = g.defineComponent<{}>("A")
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
      const Position = g.defineComponent<{x: number; y: number}>("Position")
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
      const Position = g.defineComponent<{x: number; y: number}>("Position")
      const mySystem = (pos: typeof Position) => {}
    `
    const output = transform(input)
    expect(output).toContain("params: [{ read: Position }]")
  })

  test("transforms Unique query parameter", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Position = g.defineComponent<{x: number; y: number}>("Position")
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
      const Position = g.defineComponent<{x: number; y: number}>("Position")
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
      const Position = g.defineComponent<{x: number; y: number}>("Position")
      const Name = g.defineComponent<string>("Name")
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
      const Position = g.defineComponent<{x: number; y: number}>("Position")
      const Name = g.defineComponent<string>("Name")
      const ChildOf = g.defineRelation("ChildOf")
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
      const Position = g.defineComponent<{x: number; y: number}>("Position")
      const Name = g.defineComponent<string>("Name")
      const ChildOf = g.defineRelation("ChildOf")
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
      const Position = g.defineComponent<{x: number; y: number}>("Position")
      const Name = g.defineComponent<string>("Name")
      const ChildOf = g.defineRelation("ChildOf")
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
      const Position = g.defineComponent<{x: number; y: number}>("Position")
      const MoveCommand = g.defineComponent<{dx: number; dy: number}>("MoveCommand")
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
      const Position = g.defineComponent<{x: number; y: number}>("Position")
      const MoveCommand = g.defineComponent<{dx: number; dy: number}>("MoveCommand")
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

  test("transforms Write term in Join query with version bump (canvas movementSystem)", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Position = g.defineComponent<{x: number; y: number}>("Position")
      const MoveCommand = g.defineComponent<{dx: number; dy: number}>("MoveCommand")
      const SPEED = 2
      function movementSystem(
        query: g.Join<
          g.All<g.Write<typeof Position>>,
          g.All<typeof MoveCommand>,
          typeof g.CommandOf
        >,
      ) {
        for (const [pos, move] of query) {
          pos.x += move.dx * SPEED
          pos.y += move.dy * SPEED
        }
      }
    `
    const output = transform(input)
    // Write terms should be compiled like Read (store access) + version bumping
    expect(output).toContain("const pos = _store")
    expect(output).toContain("const move = _store")
    // Should have write version preamble
    expect(output).toContain("_world_query")
    expect(output).toContain("_wcompId")
    // Should have version bump statement
    expect(output).toContain("_world_query.tick")
  })

  test("handles omitted binding elements in destructuring", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Position = g.defineComponent<{x: number; y: number}>("Position")
      const Velocity = g.defineComponent<{dx: number; dy: number}>("Velocity")
      const system = (q: g.All<typeof Position, typeof Velocity>) => {
        for (const [pos, ] of q) {
          pos.x += 1
        }
      }
    `
    const output = transform(input)
    expect(output).toContain("_store0_q")
    expect(output).toContain("pos")
    expect(output).not.toContain("undefined.name")
  })

  test("handles omitted binding elements in Join destructuring", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Position = g.defineComponent<{x: number; y: number}>("Position")
      const Name = g.defineComponent<string>("Name")
      const ChildOf = g.defineRelation("ChildOf")
      const system = (q: g.Join<g.All<typeof Position>, g.All<g.Entity, typeof Name>, typeof ChildOf>) => {
        for (const [pos, , name] of q) {
          console.log(pos, name)
        }
      }
    `
    const output = transform(input)
    expect(output).toContain("_q0_q = q.joins[0]")
    expect(output).toContain("_q1_q = q.joins[1]")
    expect(output).toContain("pos")
    expect(output).toContain("name")
  })

  test("skips tag terms in query results (bare typeof Tag)", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Position = g.defineComponent<{x: number; y: number}>("Position")
      const Player = g.defineTag("Player")
      const system = (q: g.All<typeof Player, typeof Position>) => {
        for (const [pos] of q) {
          pos.x += 1
        }
      }
    `
    const output = transform(input)
    // Tag should produce {has: Player} in descriptor, not {read: Player}
    expect(output).toContain("{ has: Player }")
    expect(output).not.toContain("{ read: Player }")
    // pos should map to the Position store (index 0), not the Player tag
    expect(output).toContain("_store0_q")
    expect(output).toContain("const pos = _store0_q[")
  })

  test("skips tag terms in query results (Read<typeof Tag>)", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Position = g.defineComponent<{x: number; y: number}>("Position")
      const Player = g.defineTag("Player")
      const system = (q: g.All<g.Read<typeof Player>, g.Write<typeof Position>>) => {
        for (const [pos] of q) {
          pos.x += 1
        }
      }
    `
    const output = transform(input)
    // Read<Tag> should produce {has: Player} in descriptor
    expect(output).toContain("{ has: Player }")
    expect(output).not.toContain("{ read: Player }")
    // pos should be the only value binding
    expect(output).toContain("const pos = _store0_q[")
  })

  test("skips Has and Not terms in query results", () => {
    const input = `
      import * as g from "@glom/ecs"
      const A = g.defineComponent<{val: number}>("A")
      const B = g.defineComponent<{val: number}>("B")
      const system = (q: g.All<g.Entity, g.Has<typeof A>, g.Not<typeof B>>) => {
        for (const [entity] of q) {
          console.log(entity)
        }
      }
    `
    const output = transform(input)
    expect(output).toContain("{ has: A }")
    expect(output).toContain("{ not: B }")
    // entity is the only value term — should be first binding
    expect(output).toContain("const entity = _e0_q")
  })

  test("transforms doubly aliased Join query", () => {
    const input = `
      namespace g {
        export type All<T0, T1=any, T2=any, T3=any, T4=any, T5=any, T6=any, T7=any> = { __all: true };
        export type Join<L, R, Rel=undefined> = { __join: true };
        export const defineComponent = <T>() => ({ __component_brand: true } as any);
      }
      const Pos = g.defineComponent<{x: number}>("Pos");
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

describe("auto-serde for defineComponent", () => {
  test("generates serde for flat object with number fields", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Position = g.defineComponent<{x: number; y: number}>("Position")
    `
    const output = transform(input)
    expect(output).toContain("bytesPerElement: 16")
    expect(output).toContain("writeFloat64")
    expect(output).toContain("readFloat64")
    expect(output).toContain("val.x")
    expect(output).toContain("val.y")
    // decode reuses existing value when provided
    expect(output).toContain("value")
    expect(output).toContain("v.x = reader.readFloat64()")
    expect(output).toContain("v.y = reader.readFloat64()")
    expect(output).toContain("return v")
  })

  test("generates serde for bare number", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Score = g.defineComponent<number>("Score")
    `
    const output = transform(input)
    expect(output).toContain("bytesPerElement: 8")
    expect(output).toContain("writer.writeFloat64(val)")
    expect(output).toContain("reader.readFloat64()")
  })

  test("generates serde for bare boolean", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Active = g.defineComponent<boolean>("Active")
    `
    const output = transform(input)
    expect(output).toContain("bytesPerElement: 1")
    expect(output).toContain("writeUint8")
    expect(output).toContain("val ? 1 : 0")
    expect(output).toContain("readUint8() !== 0")
  })

  test("generates serde for mixed number and boolean fields", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Config = g.defineComponent<{speed: number; active: boolean}>("Config")
    `
    const output = transform(input)
    // 8 (number) + 1 (boolean) = 9
    expect(output).toContain("bytesPerElement: 9")
    expect(output).toContain("val.speed")
    expect(output).toContain("val.active ? 1 : 0")
    expect(output).toContain("v.speed = reader.readFloat64()")
    expect(output).toContain("v.active = reader.readUint8() !== 0")
  })

  test("skips when serde already provided", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Position = g.defineComponent<{x: number; y: number}>("Position", {
        bytesPerElement: 8,
        encode: (val: any, writer: any) => { writer.writeFloat32(val.x); writer.writeFloat32(val.y); },
        decode: (reader: any) => ({ x: reader.readFloat32(), y: reader.readFloat32() })
      })
    `
    const output = transform(input)
    // Should keep the original float32 serde, not inject float64
    expect(output).toContain("bytesPerElement: 8")
    expect(output).toContain("writeFloat32")
    expect(output).not.toContain("writeFloat64")
  })

  test("skips unsupported types (string)", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Name = g.defineComponent<string>("Name")
    `
    const output = transform(input)
    expect(output).not.toContain("bytesPerElement")
    expect(output).not.toContain("encode")
  })

  test("skips objects with unsupported field types", () => {
    const input = `
      import * as g from "@glom/ecs"
      const Info = g.defineComponent<{name: string; value: number}>("Info")
    `
    const output = transform(input)
    expect(output).not.toContain("bytesPerElement")
    expect(output).not.toContain("encode")
  })

  test("works with direct import (no namespace)", () => {
    const input = `
      import { defineComponent } from "@glom/ecs"
      const Vel = defineComponent<{dx: number; dy: number}>("Vel")
    `
    const output = transform(input)
    expect(output).toContain("bytesPerElement: 16")
    expect(output).toContain("val.dx")
    expect(output).toContain("val.dy")
  })
})
