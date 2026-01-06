import type {Entity} from "./entity"
import type {RelationPair} from "./relation_registry"

export type SnapshotBlock = {
  component_id: number
  entities: number[]
  data: unknown[]
}

export type SnapshotMessage = {
  tick: number
  blocks: SnapshotBlock[]
}

export type SpawnComponent = {
  id: number
  data?: unknown
  rel?: RelationPair
}

export type SpawnOp = {
  type: "spawn"
  entity: Entity
  components: SpawnComponent[]
  causal_key?: number
}

export type DespawnOp = {type: "despawn"; entity: Entity}

export type SetOp = {
  type: "set"
  entity: Entity
  component_id: number
  data: unknown
  version?: number
  rel?: RelationPair
}

export type RemoveOp = {type: "remove"; entity: Entity; component_id: number}

export type ReplicationOp = SpawnOp | DespawnOp | SetOp | RemoveOp

export type Transaction = {
  domain_id: number
  seq: number
  tick: number
  ops: ReplicationOp[]
}
