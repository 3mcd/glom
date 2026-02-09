import type {ComponentResolver} from "./component"
import type {Entity} from "./entity"
import type {ByteReader, ByteWriter} from "./lib/binary"
import type {SnapshotBlock, SnapshotMessage} from "./net_types"
import type {RelationPair} from "./relation_registry"
import type {ReplicationOp, SpawnComponent, Transaction} from "./replication"

export type ResolverLike =
  | ComponentResolver
  | {readonly componentRegistry: ComponentResolver}

function toResolver(res: ResolverLike): ComponentResolver {
  return "componentRegistry" in res ? res.componentRegistry : res
}

export enum MessageType {
  Handshake = 0x01,
  Clocksync = 0x02,
  Transaction = 0x03,
  Command = 0x04,
  Snapshot = 0x05,
}

export type MessageHeader = {
  type: MessageType
  tick: number
}

export function writeMessageHeader(
  writer: ByteWriter,
  type: MessageType,
  tick: number,
) {
  writer.writeUint8(type)
  writer.writeUint32(tick)
}

export function readMessageHeader(reader: ByteReader): MessageHeader {
  return {
    type: reader.readUint8(),
    tick: reader.readUint32(),
  }
}

export type HandshakeClient = {
  version: number
}

export type HandshakeServer = {
  domainId: number
  tick: number
}

export function writeHandshakeClient(
  writer: ByteWriter,
  tick: number,
  data: HandshakeClient,
) {
  writeMessageHeader(writer, MessageType.Handshake, tick)
  writer.writeUint8(data.version)
}

export function readHandshakeClient(reader: ByteReader): HandshakeClient {
  return {
    version: reader.readUint8(),
  }
}

export function writeHandshakeServer(
  writer: ByteWriter,
  tick: number,
  data: HandshakeServer,
) {
  writeMessageHeader(writer, MessageType.Handshake, tick)
  writer.writeUint8(data.domainId)
  writer.writeUint32(data.tick)
}

export function readHandshakeServer(reader: ByteReader): HandshakeServer {
  return {
    domainId: reader.readUint8(),
    tick: reader.readUint32(),
  }
}

export type Clocksync = {
  t0: number
  t1: number
  t2: number
}

export function writeClocksync(
  writer: ByteWriter,
  tick: number,
  data: Clocksync,
) {
  writeMessageHeader(writer, MessageType.Clocksync, tick)
  writer.writeFloat64(data.t0)
  writer.writeFloat64(data.t1)
  writer.writeFloat64(data.t2)
}

export function readClocksync(reader: ByteReader): Clocksync {
  return {
    t0: reader.readFloat64(),
    t1: reader.readFloat64(),
    t2: reader.readFloat64(),
  }
}

export type CommandMessage = {
  tick: number
  commands: {target: number; componentId: number; data: unknown}[]
}

export function writeCommands(
  writer: ByteWriter,
  data: CommandMessage,
  resolverLike: ResolverLike,
) {
  const resolver = toResolver(resolverLike)
  writeMessageHeader(writer, MessageType.Command, data.tick)
  writer.writeUint16(data.commands.length)
  for (const cmd of data.commands) {
    writer.writeVarint(cmd.target)
    writer.writeVarint(cmd.componentId)
    if (cmd.data !== undefined) {
      const serde = resolver.getSerde(cmd.componentId)
      if (serde) {
        serde.encode(cmd.data, writer)
      }
    }
  }
}

export function readCommands(
  reader: ByteReader,
  tick: number,
  resolverLike: ResolverLike,
): CommandMessage {
  const resolver = toResolver(resolverLike)
  const count = reader.readUint16()
  const commands: {target: number; componentId: number; data: unknown}[] = []
  for (let i = 0; i < count; i++) {
    const target = reader.readVarint()
    const id = reader.readVarint()
    let data: unknown
    if (!resolver.isTag(id)) {
      const serde = resolver.getSerde(id)
      if (serde) {
        data = serde.decode(reader, undefined as unknown)
      }
    }
    commands.push({target, componentId: id, data})
  }
  return {
    tick,
    commands,
  }
}

export function writeSnapshot(
  writer: ByteWriter,
  data: SnapshotMessage,
  resolverLike: ResolverLike,
) {
  const resolver = toResolver(resolverLike)
  writeMessageHeader(writer, MessageType.Snapshot, data.tick)
  writer.writeUint16(data.blocks.length)

  for (const block of data.blocks) {
    writer.writeVarint(block.componentId)
    writer.writeUint16(block.entities.length)

    const serde = resolver.getSerde(block.componentId)
    const isTag = resolver.isTag(block.componentId)

    for (let i = 0; i < block.entities.length; i++) {
      writer.writeVarint(block.entities[i]!)
      if (!isTag && serde && block.data[i] !== undefined) {
        serde.encode(block.data[i], writer)
      }
    }
  }
}

export function readSnapshot(
  reader: ByteReader,
  tick: number,
  resolverLike: ResolverLike,
): SnapshotMessage {
  const resolver = toResolver(resolverLike)
  const blockCount = reader.readUint16()
  const blocks: SnapshotBlock[] = []

  for (let i = 0; i < blockCount; i++) {
    const componentId = reader.readVarint()
    const entityCount = reader.readUint16()
    const entities: number[] = []
    const data: unknown[] = []

    const serde = resolver.getSerde(componentId)
    const isTag = resolver.isTag(componentId)

    for (let j = 0; j < entityCount; j++) {
      entities.push(reader.readVarint())
      if (!isTag && serde) {
        data.push(serde.decode(reader, undefined as unknown))
      } else {
        data.push(undefined)
      }
    }

    blocks.push({componentId, entities, data})
  }

  return {
    tick,
    blocks,
  }
}

/**
 * Like readSnapshot but defers decoding: captures the remaining snapshot body
 * as a raw Uint8Array. When the returned SnapshotMessage is later passed to
 * applySnapshotStream / applySnapshotStreamVersioned, it will be decoded and
 * applied in a single pass — avoiding all intermediate SnapshotBlock allocations.
 *
 * Assumes the reader's remaining bytes are entirely the snapshot body
 * (one message per buffer). For multi-message buffers, use readSnapshot instead.
 */
export function readSnapshotLazy(
  reader: ByteReader,
  tick: number,
): SnapshotMessage {
  const raw = reader.buffer.slice(reader.cursor)
  reader.cursor = reader.buffer.byteLength
  return {
    tick,
    blocks: [],
    _raw: raw,
  }
}

enum OpCode {
  Spawn = 1,
  Despawn = 2,
  Set = 3,
  Remove = 4,
  Add = 5,
}

export function writeTransaction(
  writer: ByteWriter,
  transaction: Transaction,
  resolverLike: ResolverLike,
) {
  const resolver = toResolver(resolverLike)
  writeMessageHeader(writer, MessageType.Transaction, transaction.tick)
  writer.writeUint8(transaction.domainId)
  writer.writeVarint(transaction.seq)
  writer.writeUint16(transaction.ops.length)

  for (const op of transaction.ops) {
    switch (op.type) {
      case "spawn":
        writer.writeUint8(OpCode.Spawn)
        writer.writeVarint(op.entity as number)
        writer.writeUint16(op.components.length)
        for (const c of op.components) {
          writer.writeVarint(c.id)
          if (!resolver.isTag(c.id)) {
            const serde = resolver.getSerde(c.id)
            if (serde) {
              serde.encode(c.data, writer)
            }
          }
          if (c.rel) {
            writer.writeUint8(1)
            writer.writeVarint(c.rel.relationId)
            writer.writeVarint(c.rel.object)
          } else {
            writer.writeUint8(0)
          }
        }
        if (op.causalKey !== undefined) {
          writer.writeUint8(1)
          writer.writeUint32(op.causalKey)
        } else {
          writer.writeUint8(0)
        }
        break

      case "despawn":
        writer.writeUint8(OpCode.Despawn)
        writer.writeVarint(op.entity as number)
        break

      case "set":
        writer.writeUint8(OpCode.Set)
        writer.writeVarint(op.entity as number)
        writer.writeVarint(op.componentId)
        if (!resolver.isTag(op.componentId)) {
          const serde = resolver.getSerde(op.componentId)
          if (serde) {
            serde.encode(op.data, writer)
          }
        }
        if (op.version !== undefined) {
          writer.writeUint8(1)
          writer.writeVarint(op.version)
        } else {
          writer.writeUint8(0)
        }
        if (op.rel) {
          writer.writeUint8(1)
          writer.writeVarint(op.rel.relationId)
          writer.writeVarint(op.rel.object)
        } else {
          writer.writeUint8(0)
        }
        break

      case "remove":
        writer.writeUint8(OpCode.Remove)
        writer.writeVarint(op.entity as number)
        writer.writeVarint(op.componentId)
        break

      case "add":
        writer.writeUint8(OpCode.Add)
        writer.writeVarint(op.entity as number)
        writer.writeVarint(op.componentId)
        if (!resolver.isTag(op.componentId) && op.data !== undefined) {
          writer.writeUint8(1)
          const serde = resolver.getSerde(op.componentId)
          if (serde) {
            serde.encode(op.data, writer)
          }
        } else {
          writer.writeUint8(0)
        }
        if (op.rel) {
          writer.writeUint8(1)
          writer.writeVarint(op.rel.relationId)
          writer.writeVarint(op.rel.object)
        } else {
          writer.writeUint8(0)
        }
        break
    }
  }
}

export function readTransaction(
  reader: ByteReader,
  tick: number,
  resolverLike: ResolverLike,
): Transaction {
  const resolver = toResolver(resolverLike)
  const domainId = reader.readUint8()
  const seq = reader.readVarint()
  const opCount = reader.readUint16()
  const ops: ReplicationOp[] = []

  for (let i = 0; i < opCount; i++) {
    const code = reader.readUint8()
    switch (code) {
      case OpCode.Spawn: {
        const entity = reader.readVarint() as Entity
        const compCount = reader.readUint16()
        const components: SpawnComponent[] = []
        for (let j = 0; j < compCount; j++) {
          const id = reader.readVarint()
          let data: unknown
          if (!resolver.isTag(id)) {
            const serde = resolver.getSerde(id)
            if (serde) {
              data = serde.decode(reader, undefined as unknown)
            }
          }
          let rel: RelationPair | undefined
          if (reader.readUint8() === 1) {
            rel = {
              relationId: reader.readVarint(),
              object: reader.readVarint() as Entity,
            }
          }
          components.push({id, data, rel})
        }
        let causalKey: number | undefined
        if (reader.readUint8() === 1) {
          causalKey = reader.readUint32()
        }
        ops.push({type: "spawn", entity, components, causalKey})
        break
      }
      case OpCode.Despawn: {
        const entity = reader.readVarint() as Entity
        ops.push({type: "despawn", entity})
        break
      }
      case OpCode.Set: {
        const entity = reader.readVarint() as Entity
        const componentId = reader.readVarint()
        let data: unknown
        if (!resolver.isTag(componentId)) {
          const serde = resolver.getSerde(componentId)
          if (serde) {
            data = serde.decode(reader, undefined as unknown)
          }
        }
        let version: number | undefined
        if (reader.readUint8() === 1) {
          version = reader.readVarint()
        }
        let rel: RelationPair | undefined
        if (reader.readUint8() === 1) {
          rel = {
            relationId: reader.readVarint(),
            object: reader.readVarint() as Entity,
          }
        }
        ops.push({type: "set", entity, componentId, data, version, rel})
        break
      }
      case OpCode.Remove: {
        const entity = reader.readVarint() as Entity
        const componentId = reader.readVarint()
        ops.push({type: "remove", entity, componentId})
        break
      }
      case OpCode.Add: {
        const entity = reader.readVarint() as Entity
        const componentId = reader.readVarint()
        let data: unknown
        if (reader.readUint8() === 1) {
          const serde = resolver.getSerde(componentId)
          if (serde) {
            data = serde.decode(reader, undefined as unknown)
          }
        }
        let rel: RelationPair | undefined
        if (reader.readUint8() === 1) {
          rel = {
            relationId: reader.readVarint(),
            object: reader.readVarint() as Entity,
          }
        }
        ops.push({type: "add", entity, componentId, data, rel})
        break
      }
    }
  }

  return {
    tick,
    domainId,
    seq,
    ops,
  }
}
