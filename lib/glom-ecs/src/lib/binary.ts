export class ByteWriter {
  public buffer: Uint8Array
  private view: DataView
  public cursor = 0

  constructor(initial_capacity = 1024) {
    this.buffer = new Uint8Array(initial_capacity)
    this.view = new DataView(this.buffer.buffer)
  }

  public ensure_capacity(additional: number) {
    if (this.cursor + additional > this.buffer.length) {
      const next = new Uint8Array(
        Math.max(this.buffer.length * 2, this.cursor + additional),
      )
      next.set(this.buffer)
      this.buffer = next
      this.view = new DataView(this.buffer.buffer)
    }
  }

  write_uint8(val: number) {
    this.ensure_capacity(1)
    this.view.setUint8(this.cursor++, val)
  }

  write_uint16(val: number) {
    this.ensure_capacity(2)
    this.view.setUint16(this.cursor, val, true)
    this.cursor += 2
  }

  write_uint32(val: number) {
    this.ensure_capacity(4)
    this.view.setUint32(this.cursor, val, true)
    this.cursor += 4
  }

  write_float32(val: number) {
    this.ensure_capacity(4)
    this.view.setFloat32(this.cursor, val, true)
    this.cursor += 4
  }

  write_float64(val: number) {
    this.ensure_capacity(8)
    this.view.setFloat64(this.cursor, val, true)
    this.cursor += 8
  }

  write_varint(val: number) {
    this.ensure_capacity(5)
    while (val >= 0x80) {
      this.buffer[this.cursor++] = (val & 0x7f) | 0x80
      val >>>= 7
    }
    this.buffer[this.cursor++] = val
  }

  write_bytes(bytes: Uint8Array) {
    this.ensure_capacity(bytes.length)
    this.buffer.set(bytes, this.cursor)
    this.cursor += bytes.length
  }

  get_bytes(): Uint8Array {
    return this.buffer.subarray(0, this.cursor)
  }

  get_length(): number {
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

  read_uint8(): number {
    return this.view.getUint8(this.cursor++)
  }

  read_uint16(): number {
    const val = this.view.getUint16(this.cursor, true)
    this.cursor += 2
    return val
  }

  read_uint32(): number {
    const val = this.view.getUint32(this.cursor, true)
    this.cursor += 4
    return val
  }

  read_float32(): number {
    const val = this.view.getFloat32(this.cursor, true)
    this.cursor += 4
    return val
  }

  read_float64(): number {
    const val = this.view.getFloat64(this.cursor, true)
    this.cursor += 8
    return val
  }

  read_varint(): number {
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

  read_bytes(length: number): Uint8Array {
    const bytes = this.buffer.subarray(this.cursor, this.cursor + length)
    this.cursor += length
    return bytes
  }

  has_more(): boolean {
    return this.cursor < this.buffer.byteLength
  }

  get_cursor(): number {
    return this.cursor
  }
}
