export {assert, assertDefined} from "./assert"

// Namespace module re-exports
export * as Command from "./command"
export * as Component from "./component"
export * as Entity from "./entity"
export * as History from "./history"
export * as Relation from "./relation"
export * as SparseMap from "./sparse_map"
export * as SparseSet from "./sparse_set"
export * as System from "./system"
export * as SystemSchedule from "./system_schedule"
export * as Timestep from "./timestep"
export * as World from "./world_api"

// Re-export types that don't collide with namespace names
export type {ComponentInstance, ComponentLike, ComponentResolver, ComponentSerde} from "./component"
export type {Checkpoint, UndoEntry, UndoOp} from "./history"
export type {Relationship} from "./relation"
export type {SystemDescriptor} from "./system_descriptor"
export type {WorldOptions} from "./world"

// Entity graph
export {
  type EntityGraph,
  type EntityGraphNode,
  entityGraphGetEntityNode,
} from "./entity_graph"

// Entity registry
export {getDomain} from "./entity_registry"

// Binary utilities
export {
  acquireWriter,
  ByteReader,
  ByteWriter,
  releaseWriter,
} from "./lib/binary"

// Net types
export type {AddOp, SnapshotMessage} from "./net_types"

// Protocol
export {
  type Clocksync,
  type HandshakeClient,
  type HandshakeServer,
  MessageType,
  readClocksync,
  readCommands,
  readHandshakeClient,
  readHandshakeServer,
  readMessageType,
  readSnapshot,
  readTransaction,
  writeClocksync,
  writeCommands,
  writeHandshakeClient,
  writeHandshakeServer,
  writeTransaction,
} from "./protocol"

// Query
export {All, In, Join, Out, Unique} from "./query/all"
export {
  Add,
  Despawn,
  Has,
  Not,
  Read,
  Remove,
  Spawn,
  World as WorldTerm,
  Write,
} from "./query/term"

// Reconciliation
export {
  applyRemoteSnapshots,
  applyRemoteSnapshotsVersioned,
  applyRemoteTransactions,
  cleanupGhosts,
  cleanupTransientEntities,
  performBatchReconciliation,
  performReconciliation,
  performRollback,
  pruneBuffers,
  receiveSnapshot,
  receiveTransaction,
  reconcileTransaction,
  resimulateWithTransactions,
} from "./reconciliation"

// Registry
export {
  ComponentRegistry,
  makeComponentRegistry,
} from "./registry"

// Relation registry
export {
  deleteObjectSubjects,
  getObjectSubjects,
  getOrCreateObjectSubjects,
  getOrCreateVirtualMap,
  getRelationPair,
  getVirtualId,
  getVirtualMap,
  type RelationPair,
  type RelationSubject,
  setRelationPair,
} from "./relation_registry"

// Replication
export {
  advanceWorldTick,
  applyTransaction,
  clearReplicationStream,
  commitPendingMutations,
  emitSnapshots,
  makeCausalKey,
  pruneTemporalBuffers,
  type ReplicationOp,
  rebindEntity,
  type Transaction,
} from "./replication"
export {
  IncomingSnapshots,
  IncomingTransactions,
  Replicated,
  ReplicationConfig,
  ReplicationStream,
} from "./replication_config"

// Snapshot stream
export {
  applySnapshotStream,
  applySnapshotStreamVersioned,
  writeSnapshot,
} from "./snapshot_stream"

// Monitors
export {GlomMonitors} from "./systems/monitors"
