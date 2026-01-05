# Entity Registry

The `EntityRegistry` manages entity allocation. It is designed so that entities can be created and destroyed across different nodes without ID collisions.

## Domains

The registry uses domains (or "buckets"). Each domain has a unique ID, which is the `hi` bits of an `Entity`.

Every agent owns one domain. When an agent creates an entity, it uses its own domain ID. This prevents collisions because other agents use different domain IDs.

## Predictive Spawning

Because each agent has its own ID space, they can spawn entities immediately in their local world. Other agents will receive these events later and add the entity to their local copy of that domain.

## Determinism and Rollback

ID allocation is deterministic. Within a domain, the local ID increments. If you reset the world and run the same spawning logic, you will get the same sequence of IDs.

Each domain also tracks an operation sequence number (`op_seq`). This helps remote agents verify that they have received all changes in the correct order.

## Conflict Avoidance

Glom avoids conflicts by enforcing domain ownership. Only the assigned agent can allocate IDs from a domain. Other agents can see these entities but cannot create new ones in that space.
