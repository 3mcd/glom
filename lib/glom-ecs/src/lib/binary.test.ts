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

  test("float64 read/write", () => {
    const writer = new ByteWriter()
    writer.writeFloat64(Math.PI)
    writer.writeFloat64(Number.MAX_VALUE)
    writer.writeFloat64(Number.MIN_VALUE)

    const reader = new ByteReader(writer.getBytes())
    expect(reader.readFloat64()).toBe(Math.PI)
    expect(reader.readFloat64()).toBe(Number.MAX_VALUE)
    expect(reader.readFloat64()).toBe(Number.MIN_VALUE)
  })

  test("bytes read/write", () => {
    const writer = new ByteWriter()
    const data = new Uint8Array([1, 2, 3, 4, 5])
    writer.writeBytes(data)
    writer.writeUint8(255)

    const reader = new ByteReader(writer.getBytes())
    expect(reader.readBytes(5)).toEqual(data)
    expect(reader.readUint8()).toBe(255)
  })

  test("reset behavior", () => {
    const writer = new ByteWriter()
    writer.writeUint32(100)
    writer.reset()
    expect(writer.getLength()).toBe(0)
    writer.writeUint32(200)

    const reader = new ByteReader(writer.getBytes())
    expect(reader.readUint32()).toBe(200)

    const newData = new Uint8Array([10, 20])
    reader.reset(newData)
    expect(reader.getCursor()).toBe(0)
    expect(reader.readUint8()).toBe(10)
    expect(reader.hasMore()).toBe(true)
    expect(reader.readUint8()).toBe(20)
    expect(reader.hasMore()).toBe(false)
  })

  test("ByteReader with offset/length", () => {
    const buffer = new Uint8Array([0, 0, 42, 0, 0])
    const reader = new ByteReader(buffer.subarray(2, 3))
    expect(reader.readUint8()).toBe(42)
    expect(reader.hasMore()).toBe(false)
  })
})
