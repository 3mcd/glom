import type {InDescriptor, OutDescriptor} from "../descriptors"
import type {Entity} from "../entity"
import {
  type EntityGraphNode,
  entityGraphNodeAddListener,
  entityGraphNodeRemoveListener,
} from "../entity_graph"
import {sparseMapGet, sparseMapHas} from "../sparse_map"
import {
  makeSparseSet,
  sparseSetAdd,
  sparseSetClear,
  sparseSetDelete,
  sparseSetValues,
} from "../sparse_set"
import type {World} from "../world"
import {AllRuntime, type TermInfo} from "./all_runtime"

type MonitorMode = "in" | "out"

export class MonitorRuntime extends AllRuntime {
  readonly added = makeSparseSet<Entity>()
  readonly removed = makeSparseSet<Entity>()
  private _mode: MonitorMode
  private _joinListeners: {node: EntityGraphNode; listener: any}[] = []

  constructor(desc: InDescriptor | OutDescriptor, mode: MonitorMode) {
    super(
      mode === "in" ? (desc as InDescriptor).in : (desc as OutDescriptor).out,
    )
    this._mode = mode
  }

  override setup(world: World): void {
    super.setup(world)

    for (let i = 0; i < this.joins.length; i++) {
      const join = this.joins[i]!
      const listener = {
        entitiesIn: (entities: Entity[], node: EntityGraphNode) =>
          this.entitiesIn(entities, node, i),
        entitiesOut: (entities: Entity[], node: EntityGraphNode) =>
          this.entitiesOut(entities, node, i),
      }
      entityGraphNodeAddListener(join.anchorNode, listener)
      this._joinListeners.push({node: join.anchorNode, listener})
    }
  }

  entitiesIn(entities: Entity[], _node: EntityGraphNode, joinIndex: number): void {
    const world = this._world
    if (!world) return

    if (joinIndex === 0) {
      for (let j = 0; j < entities.length; j++) {
        const e = entities[j]!
        sparseSetAdd(this.added, e)
        sparseSetDelete(this.removed, e)
      }
    } else {
      // Object moved in, find subjects
      this._propagate_relation_change(entities, joinIndex, "in")
    }
  }

  entitiesOut(entities: Entity[], _node: EntityGraphNode, joinIndex: number): void {
    const world = this._world
    if (!world) return

    if (joinIndex === 0) {
      for (let j = 0; j < entities.length; j++) {
        const e = entities[j]!
        sparseSetAdd(this.removed, e)
        sparseSetDelete(this.added, e)
      }
    } else {
      // Object moved out, find subjects
      this._propagate_relation_change(entities, joinIndex, "out")
    }
  }

  private _propagate_relation_change(
    entities: Entity[],
    joinIndex: number,
    direction: "in" | "out",
  ): void {
    const world = this._world
    if (!world) return

    // Find all rel terms that point to this joinIndex
    for (const info of this._term_infos) {
      this._find_and_propagate(info, entities, joinIndex, direction)
    }
  }

  private _find_and_propagate(
    info: TermInfo,
    entities: Entity[],
    targetJoinIndex: number,
    direction: "in" | "out",
  ): void {
    if (info.type !== "rel") return

    if (info.nextJoinIndex === targetJoinIndex) {
      const world = this._world!
      const relationId = info.relationId
      const subjectsToNotify = new Set<Entity>()

      for (const entity of entities) {
        const incoming = world.relations.objectToSubjects.get(entity)
        if (!incoming) continue

        for (const rel of incoming) {
          if (rel.relationId === relationId) {
            subjectsToNotify.add(rel.subject as Entity)
          }
        }
      }

      if (subjectsToNotify.size > 0) {
        const subjectList = Array.from(subjectsToNotify)
        if (info.joinIndex === 0) {
          for (const s of subjectList) {
            if (direction === "in") {
              sparseSetAdd(this.added, s)
              sparseSetDelete(this.removed, s)
            } else {
              sparseSetAdd(this.removed, s)
              sparseSetDelete(this.added, s)
            }
          }
        } else {
          this._propagate_relation_change(
            subjectList,
            info.joinIndex,
            direction,
          )
        }
      }
    } else {
      this._find_and_propagate(
        info.objectTerm,
        entities,
        targetJoinIndex,
        direction,
      )
    }
  }

  override *[Symbol.iterator](): Iterator<unknown[]> {
    const world = this._world
    if (!world) return

    const targets = this._mode === "in" ? this.added : this.removed
    const entities = sparseSetValues(targets)

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]!
      yield* this._yield_entity_monitor(
        entity,
        0,
        new Array(this._term_infos.length),
      )
    }
  }

  private *_yield_entity_monitor(
    entity: Entity,
    termIdx: number,
    currentResult: unknown[],
  ): IterableIterator<unknown[]> {
    const termInfos = this._term_infos
    if (termIdx === termInfos.length) {
      yield [...currentResult]
      return
    }

    const info = termInfos[termIdx]
    if (!info) return

    const values = this._get_term_values_monitor(entity, info)

    for (let i = 0; i < values.length; i++) {
      const val = values[i]
      currentResult[termIdx] = val
      yield* this._yield_entity_monitor(entity, termIdx + 1, currentResult)
    }
  }

  private _get_term_values_monitor(entity: Entity, info: TermInfo): unknown[] {
    const world = this._world
    if (!world) return []

    if (info.type === "entity") return [entity]
    if (info.type === "component") {
      if (!info.store) return [undefined]
      const index = sparseMapGet(world.index.entityToIndex, entity as number)
      if (index === undefined) return []
      const val = info.store[index]
      return val === undefined ? [] : [val]
    }
    if (info.type === "has" || info.type === "not") {
      const node = sparseMapGet(world.entityGraph.byEntity, entity as number)
      const hasComponent = node ? node.vec.sparse.has(info.componentId) : false
      if (info.type === "has") {
        if (hasComponent) return [undefined]
        if (this._mode === "out") return [undefined]
        return []
      } else {
        if (!hasComponent) return [undefined]
        if (this._mode === "out") return [undefined]
        return []
      }
    }
    if (info.type === "rel") {
      const nextJoin = this.joins[info.nextJoinIndex]
      if (!nextJoin) return []

      const results: unknown[] = []
      const relationId = info.relationId

      for (let i = 0; i < nextJoin.nodes.length; i++) {
        const n = nextJoin.nodes[i] as EntityGraphNode
        const relMap = n.relMaps[relationId]
        if (!relMap) continue

        const targets = relMap.subjectToObjects.get(entity as number)
        if (!targets) continue

        const targetEntities = targets.dense
        for (let j = 0; j < targetEntities.length; j++) {
          const targetEntity = targetEntities[j] as Entity
          results.push(
            ...this._get_term_values_monitor(targetEntity, info.objectTerm),
          )
        }
      }

      if (results.length === 0 && this._mode === "out") {
        // For Out monitors, if we can't find the objects in the current join nodes,
        // we should still try to yield something so the subject is matched.
        // We look at the subject's own node to find ITS objects for this relation.
        const subjectNode = sparseMapGet(
          world.entityGraph.byEntity,
          entity as number,
        )
        if (subjectNode) {
          const relMap = subjectNode.relMaps[relationId]
          if (relMap) {
            const targets = relMap.subjectToObjects.get(entity as number)
            if (targets) {
              const targetEntities = targets.dense
              for (let j = 0; j < targetEntities.length; j++) {
                const targetEntity = targetEntities[j] as Entity
                results.push(
                  ...this._get_term_values_monitor(
                    targetEntity,
                    info.objectTerm,
                  ),
                )
              }
            }
          }
        }

        // If still nothing, but it's an Out monitor, just yield undefined to satisfy the join.
        if (results.length === 0) {
          return [undefined]
        }
      }

      return results
    }
    return []
  }

  clear() {
    sparseSetClear(this.added)
    sparseSetClear(this.removed)
  }

  override teardown(): void {
    for (const {node, listener} of this._joinListeners) {
      entityGraphNodeRemoveListener(node, listener)
    }
    this._joinListeners.length = 0
    super.teardown()
    this.clear()
  }
}

export function makeIn(desc: InDescriptor) {
  return new MonitorRuntime(desc, "in")
}

export function makeOut(desc: OutDescriptor) {
  return new MonitorRuntime(desc, "out")
}
