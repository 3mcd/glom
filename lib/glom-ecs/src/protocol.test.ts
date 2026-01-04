import {describe, expect, test} from "bun:test"
import type {ComponentSerde, ComponentResolver} from "./component"
import type {Entity} from "./entity"
import {ByteReader, ByteWriter} from "./lib/binary"
import {
  MessageType,
  read_clocksync,
  read_handshake_client,
  read_message_header,
  read_transaction,
  write_clocksync,
  write_handshake_client,
  write_transaction,
} from "./protocol"
import type {Transaction} from "./replication"

describe("protocol serialization", () => {
  test("handshake client", () => {
    const writer = new ByteWriter()
    write_handshake_client(writer, 100, {version: 1})

    const reader = new ByteReader(writer.get_bytes())
    const header = read_message_header(reader)
    expect(header.type).toBe(MessageType.Handshake)
    expect(header.tick).toBe(100)

    const data = read_handshake_client(reader)
    expect(data.version).toBe(1)
  })

  test("clocksync", () => {
    const writer = new ByteWriter()
    const sync = {t0: 123.456, t1: 789.012, t2: 345.678}
    write_clocksync(writer, 200, sync)

    const reader = new ByteReader(writer.get_bytes())
    const header = read_message_header(reader)
    expect(header.type).toBe(MessageType.ClockSync)

    const data = read_clocksync(reader)
    expect(data.t0).toBe(sync.t0)
    expect(data.t1).toBe(sync.t1)
    expect(data.t2).toBe(sync.t2)
  })

  test("transaction basic", () => {
    const resolver: ComponentResolver = {
      get_serde: (id: number): ComponentSerde<any> | undefined => {
        if (id === 1) {
          return {
            bytes_per_element: 8,
            encode: (val: {x: number; y: number}, writer: ByteWriter) => {
              writer.write_float32(val.x)
              writer.write_float32(val.y)
            },
            decode: (reader: ByteReader) => {
              return {
                x: reader.read_float32(),
                y: reader.read_float32(),
              }
            },
          }
        }
        return undefined
      },
      is_tag: (id) => id === 2,
    }

    const transaction: Transaction = {
      domain_id: 1,
      seq: 42,
      tick: 500,
      ops: [
        {
          type: "spawn",
          entity: 100 as Entity,
          components: [{id: 1, data: {x: 1.5, y: 2.5}}, {id: 2}],
          causal_key: 999,
        },
      ],
    }

    const writer = new ByteWriter()
    write_transaction(writer, transaction, resolver)

    const reader = new ByteReader(writer.get_bytes())
    const header = read_message_header(reader)
    const result = read_transaction(reader, header.tick, resolver)

    expect(result.tick).toBe(500)
    expect(result.domain_id).toBe(1)
    expect(result.seq).toBe(42)
    expect(result.ops.length).toBe(1)

    const op = result.ops[0]
    expect(op).toBeDefined()
    if (op && op.type === "spawn") {
      expect(op.entity as number).toBe(100)
      expect(op.causal_key).toBe(999)
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
