import { describe, expect, test } from "bun:test"
import { ByteReader, ByteWriter } from "./binary"

describe("binary utils", () => {
  test("basic read/write", () => {
    const writer = new ByteWriter()
    writer.write_uint8(42)
    writer.write_uint16(12345)
    writer.write_uint32(0xdeadbeef)
    writer.write_float32(3.14)
    
    const reader = new ByteReader(writer.get_bytes())
    expect(reader.read_uint8()).toBe(42)
    expect(reader.read_uint16()).toBe(12345)
    expect(reader.read_uint32()).toBe(0xdeadbeef)
    expect(reader.read_float32()).toBeCloseTo(3.14, 5)
  })

  test("varint encoding", () => {
    const values = [0, 1, 127, 128, 255, 300, 10000, 0xffffffff]
    const writer = new ByteWriter()
    
    for (const v of values) {
      writer.write_varint(v)
    }
    
    const reader = new ByteReader(writer.get_bytes())
    for (const v of values) {
      expect(reader.read_varint()).toBe(v >>> 0)
    }
  })

  test("capacity expansion", () => {
    const writer = new ByteWriter(4) // Small initial capacity
    writer.write_uint32(1)
    writer.write_uint32(2) // Should expand
    
    const reader = new ByteReader(writer.get_bytes())
    expect(reader.read_uint32()).toBe(1)
    expect(reader.read_uint32()).toBe(2)
  })
})

