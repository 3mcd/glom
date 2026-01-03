import {
  type Component,
  type ComponentInstance,
  type ComponentLike,
  define_tag,
} from "./component"
import type { Entity } from "./entity"
import {
  entity_graph_find_or_create_node,
  entity_graph_get_entity_node,
  entity_graph_set_entity_node,
} from "./entity_graph"
import { alloc_entity, remove_entity } from "./entity_registry"
import { is_relationship } from "./relation"
import {
  get_or_create_virtual_id,
  get_virtual_component,
  get_virtual_id,
  register_incoming_relation,
  unregister_incoming_relation,
} from "./relation_registry"
import { sparse_map_get } from "./sparse_map"
import { make_vec, vec_difference, vec_sum } from "./vec"
import {
  delete_component_value,
  set_component_value,
  type World,
} from "./world"

export function spawn(
  world: World,
  components: (ComponentInstance<unknown> | ComponentLike)[],
  hi = 0,
): Entity {
  const entity = alloc_entity(world.registry, hi)
  const resolved_components: ComponentLike[] = []

  for (const item of components) {
    if (item && typeof item === "object" && "component" in item) {
      const inst = item as ComponentInstance<unknown>
      resolved_components.push(inst.component)
      set_component_value(
        world,
        entity,
        inst.component as Component<unknown>,
        inst.value,
      )
    } else if (item) {
      if (is_relationship(item)) {
        const vid = get_or_create_virtual_id(world, item.relation, item.object)
        resolved_components.push(get_virtual_component(world.relations, vid))
        resolved_components.push(item.relation) // Wildcard tag
        register_incoming_relation(world, entity, item.relation.id, item.object)
      } else {
        resolved_components.push(item)
      }
    }
  }

  const vec = make_vec(resolved_components)
  const node = entity_graph_find_or_create_node(world.entity_graph, vec)
  entity_graph_set_entity_node(world.entity_graph, entity, node)

  return entity
}

export function despawn(world: World, entity: Entity): void {
  const node = entity_graph_get_entity_node(world.entity_graph, entity)
  if (!node) {
    return
  }

  // 1. Clean up incoming relations where THIS entity is the object
  const incoming = world.relations.object_to_subjects.get(entity)
  if (incoming) {
    const to_remove = Array.from(incoming)
    for (const { subject, relation_id } of to_remove) {
      remove_relation(world, subject as Entity, relation_id, entity)
    }
    world.relations.object_to_subjects.delete(entity)
  }

  // 2. Clean up outgoing relations where THIS entity is the subject
  for (const comp of node.vec.elements) {
    const rel = world.relations.virtual_to_rel.get(comp.id)
    if (rel) {
      unregister_incoming_relation(
        world,
        entity,
        rel.relation_id,
        rel.object as Entity,
      )
    }
  }

  // 3. Cleanup storage values
  const index = sparse_map_get(world.index.entity_to_index, entity)
  if (index !== undefined) {
    for (const comp of node.vec.elements) {
      if (!comp.is_tag) {
        delete_component_value(world, entity, comp)
      }
    }
  }

  // 4. Move to root node (clears from graph)
  entity_graph_set_entity_node(
    world.entity_graph,
    entity,
    world.entity_graph.root,
  )

  // 5. Remove from registry
  remove_entity(world.registry, entity)
}

function remove_relation(
  world: World,
  entity: Entity,
  relation_id: number,
  object: Entity,
): void {
  const node = entity_graph_get_entity_node(world.entity_graph, entity)
  if (!node) return

  const virtual_id = get_virtual_id(world.relations, relation_id, object)
  if (virtual_id === undefined) return

  const vid_comp = get_virtual_component(world.relations, virtual_id)
  let next_vec = vec_difference(
    node.vec,
    make_vec([vid_comp as Component<unknown>]),
  )

  // Check if we should also remove the wildcard tag
  let has_other_relations = false
  for (const comp of next_vec.elements) {
    const rel = world.relations.virtual_to_rel.get(comp.id)
    if (rel && rel.relation_id === relation_id) {
      has_other_relations = true
      break
    }
  }

  if (!has_other_relations) {
    const rel_tag = define_tag(relation_id) // We need the component object for the ID
    next_vec = vec_difference(
      next_vec,
      make_vec([rel_tag as Component<unknown>]),
    )
  }

  const next_node = entity_graph_find_or_create_node(
    world.entity_graph,
    next_vec,
  )
  entity_graph_set_entity_node(world.entity_graph, entity, next_node)
}

export function add_component(
  world: World,
  entity: Entity,
  item: ComponentInstance<unknown> | ComponentLike,
): void {
  const node = entity_graph_get_entity_node(world.entity_graph, entity)
  if (!node) return

  const to_add: ComponentLike[] = []
  if (item && typeof item === "object" && "component" in item) {
    const inst = item as ComponentInstance<unknown>
    to_add.push(inst.component)
    set_component_value(
      world,
      entity,
      inst.component as Component<unknown>,
      inst.value,
    )
  } else if (item) {
    if (is_relationship(item)) {
      const vid = get_or_create_virtual_id(world, item.relation, item.object)
      to_add.push(get_virtual_component(world.relations, vid))
      to_add.push(item.relation) // Wildcard tag
      register_incoming_relation(world, entity, item.relation.id, item.object)
    } else {
      to_add.push(item)
    }
  }

  if (to_add.length > 0) {
    const next_vec = vec_sum(node.vec, make_vec(to_add))
    const next_node = entity_graph_find_or_create_node(
      world.entity_graph,
      next_vec,
    )
    entity_graph_set_entity_node(world.entity_graph, entity, next_node)
  }
}
