export type SnapshotBlock = {
  component_id: number
  entities: number[]
  data: unknown[]
}

export type SnapshotMessage = {
  tick: number
  blocks: SnapshotBlock[]
}

