import type {Entity} from "./entity"
import type {RelationPair} from "./relation_registry"

export type SnapshotBlock = {
  componentId: number
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
  causalKey?: number
}

export type DespawnOp = {type: "despawn"; entity: Entity}

export type SetOp = {
  type: "set"
  entity: Entity
  componentId: number
  data: unknown
  version?: number
  rel?: RelationPair
}

export type RemoveOp = {type: "remove"; entity: Entity; componentId: number}

export type ReplicationOp = SpawnOp | DespawnOp | SetOp | RemoveOp

export type Transaction = {
  domainId: number
  seq: number
  tick: number
  ops: ReplicationOp[]
}
