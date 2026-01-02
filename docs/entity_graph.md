# Entity Graph and Archetypes

The `EntityGraph` is the core data structure in Glom ECS for organizing and storing entities. It uses an **archetype-based** approach where entities with the exact same set of components are grouped together in "nodes".

## Archetypes and the "Vec"

In Glom ECS, an **Archetype** is defined by a unique combination of component types. This combination is represented by a `Vec` (Vector).

-   **Ordered Component Set**: A `Vec` is an ordered list of component IDs. Ordering ensures that the same set of components always results in the same `Vec` and the same hash.
-   **Node Mapping**: Each unique `Vec` maps to exactly one `EntityGraphNode`. All entities that possess exactly the components in that `Vec` are stored within that node.

## Graph Structure: Subset and Superset Links

The graph is not just a flat map of archetypes; it is a **Directed Acyclic Graph (DAG)** organized by component inclusion.

-   **Strict Hierarchy**: Cycles are logically impossible because relationships are defined by set inclusion. A node can only link to another as a specialization (adding components) or a generalization (removing components).
-   **Monotonicity**: Any path in the graph represents a monotonic increase or decrease in the number of components. You cannot return to a previous set of components by only adding more.
-   **Lattice Structure**: Unlike a simple tree, the graph allows for multiple paths to the same node (e.g., $\{A, B, C\}$ can be reached via $\{A, B\}$ or $\{B, C\}$), forming a diamond-like lattice.

-   **Subsets (Generalization)**: A node is a subset of another if all its components are present in the other node's `Vec`.
-   **Supersets (Specialization)**: A node is a superset of another if it contains all components of the other node plus at least one more.

### Linking Logic

When a new node is inserted:
1.  It is linked to its **maximal subsets** (the most specific archetypes that are contained within it).
2.  More general archetypes link to it as a **superset**.

This structure allows the ECS to efficiently navigate the relationships between different entity types.

## Graph Traversal

The graph can be traversed in two directions:

-   **Traverse Right (Towards Supersets)**: Moving "right" follows links to increasingly specific archetypes (adding components).
-   **Traverse Left (Towards Subsets)**: Moving "left" follows links to increasingly general archetypes (removing components).

## Entity Storage

Each `EntityGraphNode` maintains a `SparseSet` of entities currently belonging to that archetype.

-   **Fast Migration**: When a component is added to or removed from an entity, the entity is moved from its current node to a new node representing its updated archetype.
-   **Query Optimization**: Systems and queries can find matching entities by identifying the relevant nodes in the graph and traversing their subsets or supersets, avoiding the need to iterate over every entity in the world.

## Why use a Graph for Queries?

The primary advantage of organizing archetypes into a graph is the shift from **polling-based** to **event-based** entity resolution.

-   **Reactive Resolution**: Instead of checking every entity when it is spawned or when its components change, queries and systems can attach listeners to specific nodes in the graph.
-   **Localised Changes**: When an entity moves from one archetype to another (e.g., adding a component), only the affected nodes and their immediate neighbors in the graph need to trigger events.
-   **Eliminating Iteration**: Traditionally, finding matching entities requires iterating through all entities or archetypes. With the graph, a query can "anchor" itself to a specific node and automatically receive updates for all specialized versions (supersets) of that node.
-   **Efficient Graph Listeners**: Listeners only receive notifications when an entity enters or leaves the part of the graph they care about. This makes the system significantly more performant, especially in complex worlds with thousands of entities and many overlapping component sets.

## Performance Benefits

-   **Cache Locality**: Entities of the same type are grouped together.
-   **Efficient Event Emission**: The graph structure makes it easy to track which systems need to be notified when entities enter or leave an archetype's scope (e.g., when a query starts or stops matching an entity).

