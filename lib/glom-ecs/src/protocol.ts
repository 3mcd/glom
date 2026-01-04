import type { ComponentResolver, ComponentSerde } from "./component"
import type { Entity } from "./entity"
import type { ByteReader, ByteWriter } from "./lib/binary"
import type { SnapshotBlock, SnapshotMessage } from "./net_types"
import type { ReplicationOp, Transaction } from "./replication"

export type ResolverLike =
  | ComponentResolver
  | { readonly component_registry: ComponentResolver }

function to_resolver(res: ResolverLike): ComponentResolver {
  return "component_registry" in res ? res.component_registry : res
}

export enum MessageType {
  Handshake = 0x01,
  ClockSync = 0x02,
  Transaction = 0x03,
  Input = 0x04,
  FullStateSync = 0x05,
}

export type MessageHeader = {
  type: MessageType
  tick: number
}

export function write_message_header(
  writer: ByteWriter,
  type: MessageType,
  tick: number,
) {
  writer.write_uint8(type)
  writer.write_uint32(tick)
}

export function read_message_header(reader: ByteReader): MessageHeader {
  return {
    type: reader.read_uint8(),
    tick: reader.read_uint32(),
  }
}

// HANDSHAKE

export type HandshakeClient = {
  version: number
}

export type HandshakeServer = {
  domain_id: number
  tick: number
}

export function write_handshake_client(
  writer: ByteWriter,
  tick: number,
  data: HandshakeClient,
) {
  write_message_header(writer, MessageType.Handshake, tick)
  writer.write_uint8(data.version)
}

export function read_handshake_client(reader: ByteReader): HandshakeClient {
  return {
    version: reader.read_uint8(),
  }
}

export function write_handshake_server(
  writer: ByteWriter,
  tick: number,
  data: HandshakeServer,
) {
  write_message_header(writer, MessageType.Handshake, tick)
  writer.write_uint8(data.domain_id)
  writer.write_uint32(data.tick)
}

export function read_handshake_server(reader: ByteReader): HandshakeServer {
  return {
    domain_id: reader.read_uint8(),
    tick: reader.read_uint32(),
  }
}

// CLOCKSYNC

export type ClockSync = {
  t0: number
  t1: number
  t2: number
}

export function write_clocksync(
  writer: ByteWriter,
  tick: number,
  data: ClockSync,
) {
  write_message_header(writer, MessageType.ClockSync, tick)
  writer.write_float64(data.t0)
  writer.write_float64(data.t1)
  writer.write_float64(data.t2)
}

export function read_clocksync(reader: ByteReader): ClockSync {
  return {
    t0: reader.read_float64(),
    t1: reader.read_float64(),
    t2: reader.read_float64(),
  }
}

// COMMANDS

export type CommandMessage = {
  tick: number
  commands: { target: number; component_id: number; data: unknown }[]
}

export function write_commands(
  writer: ByteWriter,
  data: CommandMessage,
  resolver_like: ResolverLike,
) {
  const resolver = to_resolver(resolver_like)
  write_message_header(writer, MessageType.Input, data.tick)
  writer.write_uint16(data.commands.length)
  for (const cmd of data.commands) {
    writer.write_varint(cmd.target)
    writer.write_varint(cmd.component_id)
    if (cmd.data !== undefined) {
      const serde = resolver.get_serde(cmd.component_id)
      if (serde) {
        writer.ensure_capacity(serde.bytes_per_element)
        serde.encode(cmd.data, writer.buffer, writer.cursor)
        writer.cursor += serde.bytes_per_element
      }
    }
  }
}

export function read_commands(
  reader: ByteReader,
  tick: number,
  resolver_like: ResolverLike,
): CommandMessage {
  const resolver = to_resolver(resolver_like)
  const count = reader.read_uint16()
  const commands: { target: number; component_id: number; data: unknown }[] = []
  for (let i = 0; i < count; i++) {
    const target = reader.read_varint()
    const id = reader.read_varint()
    let data: unknown
    if (!resolver.is_tag(id)) {
      const serde = resolver.get_serde(id)
      if (serde) {
        data = serde.decode(reader.buffer, reader.cursor, undefined as unknown)
        reader.cursor += serde.bytes_per_element
      }
    }
    commands.push({ target, component_id: id, data })
  }
  return {
    tick,
    commands,
  }
}

// SNAPSHOTS

export function write_snapshot(
  writer: ByteWriter,
  data: SnapshotMessage,
  resolver_like: ResolverLike,
) {
  const resolver = to_resolver(resolver_like)
  write_message_header(writer, MessageType.FullStateSync, data.tick)
  writer.write_uint16(data.blocks.length)

  for (const block of data.blocks) {
    writer.write_varint(block.component_id)
    writer.write_uint16(block.entities.length)

    const serde = resolver.get_serde(block.component_id)
    const is_tag = resolver.is_tag(block.component_id)

    for (let i = 0; i < block.entities.length; i++) {
      writer.write_varint(block.entities[i]!)
      if (!is_tag && serde && block.data[i] !== undefined) {
        writer.ensure_capacity(serde.bytes_per_element)
        serde.encode(block.data[i], writer.buffer, writer.cursor)
        writer.cursor += serde.bytes_per_element
      }
    }
  }
}

export function read_snapshot(
  reader: ByteReader,
  tick: number,
  resolver_like: ResolverLike,
): SnapshotMessage {
  const resolver = to_resolver(resolver_like)
  const block_count = reader.read_uint16()
  const blocks: SnapshotBlock[] = []

  for (let i = 0; i < block_count; i++) {
    const component_id = reader.read_varint()
    const entity_count = reader.read_uint16()
    const entities: number[] = []
    const data: unknown[] = []

    const serde = resolver.get_serde(component_id)
    const is_tag = resolver.is_tag(component_id)

    for (let j = 0; j < entity_count; j++) {
      entities.push(reader.read_varint())
      if (!is_tag && serde) {
        data.push(
          serde.decode(reader.buffer, reader.cursor, undefined as unknown),
        )
        reader.cursor += serde.bytes_per_element
      } else {
        data.push(undefined)
      }
    }

    blocks.push({ component_id, entities, data })
  }

  return {
    tick,
    blocks,
  }
}

// TRANSACTION

enum OpCode {
  Spawn = 1,
  Despawn = 2,
  Set = 3,
  Remove = 4,
}

export function write_transaction(
  writer: ByteWriter,
  tx: Transaction,
  resolver_like: ResolverLike,
) {
  const resolver = to_resolver(resolver_like)
  write_message_header(writer, MessageType.Transaction, tx.tick)
  writer.write_uint8(tx.hi)
  writer.write_varint(tx.seq)
  writer.write_uint16(tx.ops.length)

  for (const op of tx.ops) {
    switch (op.type) {
      case "spawn":
        writer.write_uint8(OpCode.Spawn)
        writer.write_varint(op.entity as number)
        writer.write_uint16(op.components.length)
        for (const c of op.components) {
          writer.write_varint(c.id)
          if (!resolver.is_tag(c.id)) {
            const serde = resolver.get_serde(c.id)
            if (serde) {
              writer.ensure_capacity(serde.bytes_per_element)
              serde.encode(c.data, writer.buffer, writer.cursor)
              writer.cursor += serde.bytes_per_element
            }
          }
          if (c.rel) {
            writer.write_uint8(1) // has_rel
            writer.write_varint(c.rel.relation_id)
            writer.write_varint(c.rel.object)
          } else {
            writer.write_uint8(0) // no_rel
          }
        }
        if (op.causal_key !== undefined) {
          writer.write_uint8(1)
          writer.write_uint32(op.causal_key)
        } else {
          writer.write_uint8(0)
        }
        break

      case "despawn":
        writer.write_uint8(OpCode.Despawn)
        writer.write_varint(op.entity as number)
        break

      case "set":
        writer.write_uint8(OpCode.Set)
        writer.write_varint(op.entity as number)
        writer.write_varint(op.component_id)
        if (!resolver.is_tag(op.component_id)) {
          const serde = resolver.get_serde(op.component_id)
          if (serde) {
            writer.ensure_capacity(serde.bytes_per_element)
            serde.encode(op.data, writer.buffer, writer.cursor)
            writer.cursor += serde.bytes_per_element
          }
        }
        if (op.version !== undefined) {
          writer.write_uint8(1)
          writer.write_varint(op.version)
        } else {
          writer.write_uint8(0)
        }
        if (op.rel) {
          writer.write_uint8(1)
          writer.write_varint(op.rel.relation_id)
          writer.write_varint(op.rel.object)
        } else {
          writer.write_uint8(0)
        }
        break

      case "remove":
        writer.write_uint8(OpCode.Remove)
        writer.write_varint(op.entity as number)
        writer.write_varint(op.component_id)
        break
    }
  }
}

export function read_transaction(
  reader: ByteReader,
  tick: number,
  resolver_like: ResolverLike,
): Transaction {
  const resolver = to_resolver(resolver_like)
  const hi = reader.read_uint8()
  const seq = reader.read_varint()
  const op_count = reader.read_uint16()
  const ops: ReplicationOp[] = []

  for (let i = 0; i < op_count; i++) {
    const code = reader.read_uint8()
    switch (code) {
      case OpCode.Spawn: {
        const entity = reader.read_varint() as Entity
        const comp_count = reader.read_uint16()
        const components: {
          id: number
          data?: unknown
          rel?: { relation_id: number; object: number }
        }[] = []
        for (let j = 0; j < comp_count; j++) {
          const id = reader.read_varint()
          let data: unknown
          if (!resolver.is_tag(id)) {
            const serde = resolver.get_serde(id)
            if (serde) {
              data = serde.decode(
                reader.buffer,
                reader.cursor,
                undefined as unknown,
              )
              reader.cursor += serde.bytes_per_element
            }
          }
          let rel: { relation_id: number; object: number } | undefined
          if (reader.read_uint8() === 1) {
            rel = {
              relation_id: reader.read_varint(),
              object: reader.read_varint(),
            }
          }
          components.push({ id, data, rel })
        }
        let causal_key: number | undefined
        if (reader.read_uint8() === 1) {
          causal_key = reader.read_uint32()
        }
        ops.push({ type: "spawn", entity, components, causal_key })
        break
      }
      case OpCode.Despawn: {
        const entity = reader.read_varint() as Entity
        ops.push({ type: "despawn", entity })
        break
      }
      case OpCode.Set: {
        const entity = reader.read_varint() as Entity
        const component_id = reader.read_varint()
        let data: unknown
        if (!resolver.is_tag(component_id)) {
          const serde = resolver.get_serde(component_id)
          if (serde) {
            data = serde.decode(
              reader.buffer,
              reader.cursor,
              undefined as unknown,
            )
            reader.cursor += serde.bytes_per_element
          }
        }
        let version: number | undefined
        if (reader.read_uint8() === 1) {
          version = reader.read_varint()
        }
        let rel: { relation_id: number; object: number } | undefined
        if (reader.read_uint8() === 1) {
          rel = {
            relation_id: reader.read_varint(),
            object: reader.read_varint(),
          }
        }
        ops.push({ type: "set", entity, component_id, data, version, rel })
        break
      }
      case OpCode.Remove: {
        const entity = reader.read_varint() as Entity
        const component_id = reader.read_varint()
        ops.push({ type: "remove", entity, component_id })
        break
      }
    }
  }

  return {
    tick,
    hi,
    seq,
    ops,
  }
}
