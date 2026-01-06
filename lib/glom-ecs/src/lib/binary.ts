export class ByteWriter {
  public buffer: Uint8Array
  private view: DataView
  public cursor = 0

  constructor(initialCapacity = 1024) {
    this.buffer = new Uint8Array(initialCapacity)
    this.view = new DataView(this.buffer.buffer)
  }

  public ensureCapacity(additional: number) {
    if (this.cursor + additional > this.buffer.length) {
      const next = new Uint8Array(
        Math.max(this.buffer.length * 2, this.cursor + additional),
      )
      next.set(this.buffer)
      this.buffer = next
      this.view = new DataView(this.buffer.buffer)
    }
  }

  writeUint8(val: number) {
    this.ensureCapacity(1)
    this.view.setUint8(this.cursor++, val)
  }

  writeUint16(val: number) {
    this.ensureCapacity(2)
    this.view.setUint16(this.cursor, val, true)
    this.cursor += 2
  }

  writeUint32(val: number) {
    this.ensureCapacity(4)
    this.view.setUint32(this.cursor, val, true)
    this.cursor += 4
  }

  writeFloat32(val: number) {
    this.ensureCapacity(4)
    this.view.setFloat32(this.cursor, val, true)
    this.cursor += 4
  }

  writeFloat64(val: number) {
    this.ensureCapacity(8)
    this.view.setFloat64(this.cursor, val, true)
    this.cursor += 8
  }

  writeVarint(val: number) {
    this.ensureCapacity(5)
    while (val >= 0x80) {
      this.buffer[this.cursor++] = (val & 0x7f) | 0x80
      val >>>= 7
    }
    this.buffer[this.cursor++] = val
  }

  writeBytes(bytes: Uint8Array) {
    this.ensureCapacity(bytes.length)
    this.buffer.set(bytes, this.cursor)
    this.cursor += bytes.length
  }

  getBytes(): Uint8Array {
    return this.buffer.subarray(0, this.cursor)
  }

  getLength(): number {
    return this.cursor
  }

  public reset() {
    this.cursor = 0
  }
}

export class ByteReader {
  private view: DataView
  public cursor = 0

  constructor(public buffer: Uint8Array) {
    this.view = new DataView(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength,
    )
  }

  public reset(buffer: Uint8Array) {
    this.buffer = buffer
    this.view = new DataView(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength,
    )
    this.cursor = 0
  }

  readUint8(): number {
    return this.view.getUint8(this.cursor++)
  }

  readUint16(): number {
    const val = this.view.getUint16(this.cursor, true)
    this.cursor += 2
    return val
  }

  readUint32(): number {
    const val = this.view.getUint32(this.cursor, true)
    this.cursor += 4
    return val
  }

  readFloat32(): number {
    const val = this.view.getFloat32(this.cursor, true)
    this.cursor += 4
    return val
  }

  readFloat64(): number {
    const val = this.view.getFloat64(this.cursor, true)
    this.cursor += 8
    return val
  }

  readVarint(): number {
    let val = 0
    let shift = 0
    let b: number
    do {
      b = this.buffer[this.cursor++]
      val |= (b & 0x7f) << shift
      shift += 7
    } while (b & 0x80)
    return val >>> 0
  }

  readBytes(length: number): Uint8Array {
    const bytes = this.buffer.subarray(this.cursor, this.cursor + length)
    this.cursor += length
    return bytes
  }

  hasMore(): boolean {
    return this.cursor < this.buffer.byteLength
  }

  getCursor(): number {
    return this.cursor
  }
}
