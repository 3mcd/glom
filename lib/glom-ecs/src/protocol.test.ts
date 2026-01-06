import {describe, expect, test} from "bun:test"
import type {ComponentSerde, ComponentResolver} from "./component"
import type {Entity} from "./entity"
import {ByteReader, ByteWriter} from "./lib/binary"
import {
  MessageType,
  readClocksync,
  readHandshakeClient,
  readMessageHeader,
  readTransaction,
  writeClocksync,
  writeHandshakeClient,
  writeTransaction,
} from "./protocol"
import type {Transaction} from "./replication"

describe("protocol serialization", () => {
  test("handshake client", () => {
    const writer = new ByteWriter()
    writeHandshakeClient(writer, 100, {version: 1})

    const reader = new ByteReader(writer.getBytes())
    const header = readMessageHeader(reader)
    expect(header.type).toBe(MessageType.Handshake)
    expect(header.tick).toBe(100)

    const data = readHandshakeClient(reader)
    expect(data.version).toBe(1)
  })

  test("clocksync", () => {
    const writer = new ByteWriter()
    const sync = {t0: 123.456, t1: 789.012, t2: 345.678}
    writeClocksync(writer, 200, sync)

    const reader = new ByteReader(writer.getBytes())
    const header = readMessageHeader(reader)
    expect(header.type).toBe(MessageType.ClockSync)

    const data = readClocksync(reader)
    expect(data.t0).toBe(sync.t0)
    expect(data.t1).toBe(sync.t1)
    expect(data.t2).toBe(sync.t2)
  })

  test("transaction basic", () => {
    const resolver: ComponentResolver = {
      getSerde: (id: number): ComponentSerde<any> | undefined => {
        if (id === 1) {
          return {
            bytesPerElement: 8,
            encode: (val: {x: number; y: number}, writer: ByteWriter) => {
              writer.writeFloat32(val.x)
              writer.writeFloat32(val.y)
            },
            decode: (reader: ByteReader) => {
              return {
                x: reader.readFloat32(),
                y: reader.readFloat32(),
              }
            },
          }
        }
        return undefined
      },
      isTag: (id) => id === 2,
    }

    const transaction: Transaction = {
      domainId: 1,
      seq: 42,
      tick: 500,
      ops: [
        {
          type: "spawn",
          entity: 100 as Entity,
          components: [{id: 1, data: {x: 1.5, y: 2.5}}, {id: 2}],
          causalKey: 999,
        },
      ],
    }

    const writer = new ByteWriter()
    writeTransaction(writer, transaction, resolver)

    const reader = new ByteReader(writer.getBytes())
    const header = readMessageHeader(reader)
    const result = readTransaction(reader, header.tick, resolver)

    expect(result.tick).toBe(500)
    expect(result.domainId).toBe(1)
    expect(result.seq).toBe(42)
    expect(result.ops.length).toBe(1)

    const op = result.ops[0]
    expect(op).toBeDefined()
    if (op && op.type === "spawn") {
      expect(op.entity as number).toBe(100)
      expect(op.causalKey).toBe(999)
      expect(op.components.length).toBe(2)
      expect(op.components[0]?.id).toBe(1)
      const data = op.components[0]?.data as {x: number; y: number}
      if (data) {
        expect(data.x).toBeCloseTo(1.5, 5)
      }
      expect(op.components[1]?.id).toBe(2)
    }
  })
})
