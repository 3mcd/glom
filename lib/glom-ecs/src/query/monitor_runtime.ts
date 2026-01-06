import {
  isJoinDescriptor,
  isInDescriptor,
  isOutDescriptor,
  type InDescriptor,
  type OutDescriptor,
  type JoinDescriptor,
} from "../descriptors"
import type {Entity} from "../entity"
import {
  type EntityGraphNode,
  entityGraphNodeAddListener,
  entityGraphNodeRemoveListener,
} from "../entity_graph"
import {sparseMapGet} from "../sparse_map"
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
  private _isTopLevel: boolean

  constructor(
    desc: InDescriptor | OutDescriptor | JoinDescriptor,
    mode: MonitorMode,
  ) {
    const isTopLevel = isInDescriptor(desc) || isOutDescriptor(desc)
    super(
      isInDescriptor(desc)
        ? desc.in
        : isOutDescriptor(desc)
          ? desc.out
          : (desc as JoinDescriptor),
    )
    this._mode = mode
    this._isTopLevel = isTopLevel
  }

  override setup(world: World): void {
    super.setup(world)

    for (let i = 0; i < this.joins.length; i++) {
      const join = this.joins[i]!
      const levelMode =
        join.reactiveMode || (this._isTopLevel ? this._mode : undefined)

      if (levelMode !== undefined) {
        const listener = {
          entitiesIn: (entities: Entity[], node: EntityGraphNode) => {
            if (levelMode === "in") this.entitiesIn(entities, node, i)
          },
          entitiesOut: (entities: Entity[], node: EntityGraphNode) => {
            if (levelMode === "out") this.entitiesOut(entities, node, i)
          },
          relationAdded: (
            subject: Entity,
            relationId: number,
            object: Entity,
            node: EntityGraphNode,
          ) => {
            if (levelMode === "in")
              this.relationAdded(subject, relationId, object, node, i)
          },
          relationRemoved: (
            subject: Entity,
            relationId: number,
            object: Entity,
            node: EntityGraphNode,
          ) => {
            if (levelMode === "out")
              this.relationRemoved(subject, relationId, object, node, i)
          },
        }
        entityGraphNodeAddListener(join.anchorNode, listener, true)
        this._joinListeners.push({node: join.anchorNode, listener})
      }
    }
  }

  entitiesIn(
    entities: Entity[],
    _node: EntityGraphNode,
    joinIndex: number,
  ): void {
    const world = this._world
    if (!world) return

    if (joinIndex === 0) {
      for (let j = 0; j < entities.length; j++) {
        const e = entities[j]!
        if (this.matches(e)) {
          sparseSetAdd(this.added, e)
          sparseSetDelete(this.removed, e)
        }
      }
    } else {
      this._propagate_relation_change(entities, joinIndex, "in")
    }
  }

  entitiesOut(
    entities: Entity[],
    _node: EntityGraphNode,
    joinIndex: number,
  ): void {
    const world = this._world
    if (!world) return

    if (joinIndex === 0) {
      for (let j = 0; j < entities.length; j++) {
        const e = entities[j]!
        sparseSetAdd(this.removed, e)
        sparseSetDelete(this.added, e)
      }
    } else {
      this._propagate_relation_change(entities, joinIndex, "out")
    }
  }

  relationAdded(
    subject: Entity,
    relationId: number,
    _object: Entity,
    _node: EntityGraphNode,
    joinIndex: number,
  ): void {
    const join = this.joins[joinIndex]
    if (join && join.joinOnId === relationId) {
      if (this.matches(subject)) {
        this._notify_entities([subject], joinIndex - 1, "in")
      }
    }
  }

  relationRemoved(
    subject: Entity,
    relationId: number,
    _object: Entity,
    _node: EntityGraphNode,
    joinIndex: number,
  ): void {
    const join = this.joins[joinIndex]
    if (join && join.joinOnId === relationId) {
      if (!this.matches(subject)) {
        this._notify_entities([subject], joinIndex - 1, "out")
      }
    }
  }

  private _notify_entities(
    entities: Entity[],
    joinIndex: number,
    direction: "in" | "out",
  ): void {
    if (joinIndex === 0) {
      for (let i = 0; i < entities.length; i++) {
        const e = entities[i]!
        if (direction === "in") {
          sparseSetAdd(this.added, e)
          sparseSetDelete(this.removed, e)
        } else {
          sparseSetAdd(this.removed, e)
          sparseSetDelete(this.added, e)
        }
      }
    } else {
      this._propagate_relation_change(entities, joinIndex, direction)
    }
  }

  private _propagate_relation_change(
    entities: Entity[],
    joinIndex: number,
    direction: "in" | "out",
  ): void {
    const world = this._world
    if (!world) return

    const join = this.joins[joinIndex]
    if (join && join.joinOnId !== undefined && joinIndex > 0) {
      this._notify_subjects(
        entities,
        join.joinOnId,
        joinIndex - 1,
        direction,
      )
    }
  }

  private _notify_subjects(
    entities: Entity[],
    relationId: number,
    subjectJoinIndex: number,
    direction: "in" | "out",
  ): void {
    const world = this._world!
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
      const changedSubjects: Entity[] = []
      for (const s of subjectList) {
        if (direction === "in") {
          if (this.matches(s)) {
            changedSubjects.push(s)
          }
        } else {
          if (!this.matches(s)) {
            changedSubjects.push(s)
          }
        }
      }

      if (changedSubjects.length > 0) {
        this._notify_entities(changedSubjects, subjectJoinIndex, direction)
      }
    }
  }

  override *[Symbol.iterator](): Iterator<unknown[]> {
    const world = this._world
    if (!world) return

    const targets = this._mode === "in" ? this.added : this.removed
    const entities = sparseSetValues(targets)

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]!
      const node = sparseMapGet(world.entityGraph.byEntity, entity as number)
      if (!node && this._mode === "in") continue

      yield* this._yield_at_level_monitor(
        entity,
        node,
        0,
        new Array(this._term_infos.length),
      )
    }
  }

  private *_yield_at_level_monitor(
    entity: Entity,
    node: EntityGraphNode | undefined,
    joinLevel: number,
    currentResult: unknown[],
  ): IterableIterator<unknown[]> {
    const join = this.joins[joinLevel]
    if (!join) return

    const terms = this._term_infos.filter((t) => t.joinIndex === joinLevel)
    yield* this._yield_terms_at_level_monitor(
      entity,
      node,
      joinLevel,
      terms,
      0,
      currentResult,
    )
  }

  private *_yield_terms_at_level_monitor(
    entity: Entity,
    node: EntityGraphNode | undefined,
    joinLevel: number,
    terms: TermInfo[],
    termIdx: number,
    currentResult: unknown[],
  ): IterableIterator<unknown[]> {
    if (termIdx === terms.length) {
      const nextJoinLevel = joinLevel + 1
      if (nextJoinLevel < this.joins.length) {
        yield* this._yield_independent_level_monitor(nextJoinLevel, currentResult, entity)
      } else {
        yield [...currentResult]
      }
      return
    }

    const info = terms[termIdx]!
    const values = this._get_term_values_monitor(entity, info, node)

    const termPos = this._term_infos.indexOf(info)
    if (values.length === 0 && this._mode === "out") {
      currentResult[termPos] = undefined
      yield* this._yield_terms_at_level_monitor(
        entity,
        node,
        joinLevel,
        terms,
        termIdx + 1,
        currentResult,
      )
    } else {
      for (const val of values) {
        currentResult[termPos] = val
        yield* this._yield_terms_at_level_monitor(
          entity,
          node,
          joinLevel,
          terms,
          termIdx + 1,
          currentResult,
        )
      }
    }
  }

  private *_yield_independent_level_monitor(
    joinLevel: number,
    currentResult: unknown[],
    subjectEntity?: Entity,
  ): IterableIterator<unknown[]> {
    const join = this.joins[joinLevel]
    if (!join) return

    let yielded = false
    if (join.joinOnId !== undefined && subjectEntity !== undefined) {
      const relationId = join.joinOnId
      for (let i = 0; i < join.nodes.length; i++) {
        const n = join.nodes[i] as EntityGraphNode
        const relMap = n.relMaps[relationId]
        if (!relMap) continue

        const targets = relMap.subjectToObjects.get(subjectEntity as number)
        if (!targets) continue

        const targetEntities = targets.dense
        for (let j = 0; j < targetEntities.length; j++) {
          yielded = true
          yield* this._yield_at_level_monitor(
            targetEntities[j] as Entity,
            n,
            joinLevel,
            currentResult,
          )
        }
      }
    } else {
      for (let i = 0; i < join.nodes.length; i++) {
        const node = join.nodes[i] as EntityGraphNode
        const entities = node.entities.dense
        for (let j = 0; j < entities.length; j++) {
          yielded = true
          yield* this._yield_at_level_monitor(
            entities[j] as Entity,
            node,
            joinLevel,
            currentResult,
          )
        }
      }
    }

    if (!yielded && this._mode === "out") {
      const terms = this._term_infos.filter((t) => t.joinIndex === joinLevel)
      for (const t of terms) {
        currentResult[this._term_infos.indexOf(t)] = undefined
      }
      const nextJoinLevel = joinLevel + 1
      if (nextJoinLevel < this.joins.length) {
        yield* this._yield_independent_level_monitor(nextJoinLevel, currentResult)
      } else {
        yield [...currentResult]
      }
    }
  }

  private _get_term_values_monitor(
    entity: Entity,
    info: TermInfo,
    node?: EntityGraphNode,
  ): unknown[] {
    const world = this._world
    if (!world) return []

    if (info.type === "entity") return [entity]
    if (info.type === "component") {
      if (this._mode === "in") {
        const actualNode =
          node ?? sparseMapGet(world.entityGraph.byEntity, entity as number)
        if (!actualNode || !actualNode.vec.sparse.has(info.componentId)) return []
      }

      if (!info.store) return [undefined]
      const index = sparseMapGet(world.index.entityToIndex, entity as number)
      if (index === undefined) return []
      const val = info.store[index]
      return val === undefined ? [] : [val]
    }
    if (info.type === "has" || info.type === "not") {
      const actualNode =
        node ?? sparseMapGet(world.entityGraph.byEntity, entity as number)
      if (!actualNode) return info.type === "not" ? [undefined] : []

      const hasComponent = actualNode.vec.sparse.has(info.componentId)
      if (info.type === "has") {
        return hasComponent ? [undefined] : []
      } else {
        return !hasComponent ? [undefined] : []
      }
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
