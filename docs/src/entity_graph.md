# Entity Graph

**Problem:** Searching through thousands of entities every frame to find those that match a specific set of components is slow.

Glom is an **Archetypal** ECS. It indexes entities using an `EntityGraph`, which sorts entities into buckets based on their component makeup. 

## Archetypes

An archetype is a logical set of entities with a precise combination of component types. One of these sets is known as a `Vec`, which is fundamentally an ordered list of component IDs. Each unique `Vec` maps to one graph node.

<pre>
Query<2 0 1> ⟶ Vec<0 1 2> ⟶ Node<0 1 2>
</pre>

## Graph Structure

The entity graph is directed and acyclic. Nodes are linked based on component inclusion. The entity moves towards a more specialized node with more components when a component is added to it. Conversely, removing a component moves the entity toward a more generalized node with fewer components.

This structure forms a "lattice" where system resources (like queries) bind to specific nodes that match their required component signature:
<pre>
a = Query<2>
b = Query<0 1>
c = Query<0 1 2>
</pre>
<pre class="box">
    [0] ────┬────── (b) [0 1]───────┐
            │                       ├──── (c) [0 1 2]
    [1] ────┼───┬────── [1 2] ──────┤
            │   │                   │
(a) [2]─────┴───┴────── [0 2] ──────┘
</pre>

When an entity's component set matches one of these nodes, it is automatically included in the corresponding system's query.

## Entity Storage

Each node stores a set of entities of shared composition. The entity is migrated from its current node to a new node when a component is added or removed.

Because entities are grouped by their exact component signature, a query doesn't need to scan every entity in the world; it only looks at the entities stored in matching nodes. Queries will then look up component values in the world's storage arrays for each included term and yield them to consumers.

<pre class="box">
Entity:   0   1   2   3   4   5   6   7   8   9
        ┌───┬───┬───┬───┬───┬───┬───┬───┬───┬───┐
[0] ────┤ ■ │ ■ │   │ ■ │ ■ │   │ ■ │ ■ │ ■ │ ■ │
[1] ────┤   │ ▲ │ ▲ │ ▲ │ ▲ │ ▲ │ ▲ │   │   │ ▲ │
[2] ────┤ ● │   │   │ ● │ ● │ ● │   │   │ ● │ ● │
        └───┴───┴───┴───┴───┴───┴───┴───┴───┴───┘
                  ↑   *   *           *       *
                  │   ╰───┴───────────┴───────╯
                  ╰── Partial match (ignored)
</pre>
