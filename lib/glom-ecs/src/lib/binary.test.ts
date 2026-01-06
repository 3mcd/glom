import {describe, expect, test} from "bun:test"
import {ByteReader, ByteWriter} from "./binary"

describe("binary utils", () => {
  test("basic read/write", () => {
    const writer = new ByteWriter()
    writer.writeUint8(42)
    writer.writeUint16(12345)
    writer.writeUint32(0xdeadbeef)
    writer.writeFloat32(3.14)

    const reader = new ByteReader(writer.getBytes())
    expect(reader.readUint8()).toBe(42)
    expect(reader.readUint16()).toBe(12345)
    expect(reader.readUint32()).toBe(0xdeadbeef)
    expect(reader.readFloat32()).toBeCloseTo(3.14, 5)
  })

  test("varint encoding", () => {
    const values = [0, 1, 127, 128, 255, 300, 10000, 0xffffffff]
    const writer = new ByteWriter()

    for (const v of values) {
      writer.writeVarint(v)
    }

    const reader = new ByteReader(writer.getBytes())
    for (const v of values) {
      expect(reader.readVarint()).toBe(v >>> 0)
    }
  })

  test("capacity expansion", () => {
    const writer = new ByteWriter(4)
    writer.writeUint32(1)
    writer.writeUint32(2)

    const reader = new ByteReader(writer.getBytes())
    expect(reader.readUint32()).toBe(1)
    expect(reader.readUint32()).toBe(2)
  })
})
