# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Glom is an Entity-Component System (ECS) written in TypeScript, designed as a fast, networkable, and testable foundation for games with dynamic behavior.

## Commands

```bash
# Run all tests across workspaces
bun run --filter=* test

# Run a single test file
bun test lib/glom-ecs/src/world.test.ts

# Run benchmarks
bun run --filter=* bench

# Development server (server-authoritative example)
bun run dev

# Development server (p2p example)
bun run dev.p2p

# Format code (uses Biome)
bun x @biomejs/biome format --write .

# Lint code
bun x @biomejs/biome lint .

# Build library packages (uses Preconstruct)
bun x preconstruct build

# Build documentation
bun run docs.build
```

## Architecture

### Workspace Structure

- `lib/glom-ecs` - Core ECS library (`@glom/ecs`)
- `lib/glom-transformer` - TypeScript transformer for compile-time query optimization
- `lib/glom-transformer-bun` - Bun build plugin wrapping the transformer
- `lib/glom-transformer-rollup` - Rollup/Vite plugin wrapping the transformer
- `app/` - Example applications (p2p-canvas, server-authoritative-canvas)

### Core ECS Concepts

**Components** (`lib/glom-ecs/src/component.ts`):
- `defineComponent<T>()` - Creates data components with typed values
- `defineTag()` - Creates marker components (no data)
- Components are callable factories: `Pos({x: 0, y: 0})` creates a `ComponentInstance`

**Relations** (`lib/glom-ecs/src/relation.ts`):
- `defineRelation()` - Creates relationship types between entities
- Called with an entity to create a `Relationship`: `PlaysOn(targetEntity)`

**Queries** (`lib/glom-ecs/src/query/`):
- `All<...terms>` - Iterates entities matching all terms
- `Join<L, R, Rel?>` - Cross-product or relational join between two queries
- `In<...terms>` / `Out<...terms>` - Monitors for entities entering/leaving a component set
- `Unique<...terms>` - Singleton query, returns single entity via `.get()`

**Query Terms** (`lib/glom-ecs/src/query/term.ts`):
- `Read<C>`, `Write<C>` - Component access (Write indicates mutation intent)
- `Has<C>`, `Not<C>` - Filters without yielding component data
- `Entity` - Yields the entity ID in the iteration tuple
- `Spawn<C...>`, `Despawn`, `Add<C>`, `Remove<C>` - Mutation descriptors

**World** (`lib/glom-ecs/src/world.ts`, `world_api.ts`):
- `makeWorld()` - Creates a world instance
- `spawn(world, ...components)` - Creates an entity
- `addComponent`, `removeComponent`, `despawn` - Entity mutations
- `flushGraphChanges(world)` - Commits pending entity graph changes

**System Schedule** (`lib/glom-ecs/src/system_schedule.ts`):
- `makeSystemSchedule()` - Creates a schedule
- `addSystem(schedule, system)` - Registers a system
- `runSchedule(schedule, world)` - Executes all systems in dependency order

### Build-Time Transformer

The transformer (`lib/glom-transformer/src/transformer.ts`) performs two key optimizations:

1. **Query loop inlining**: Converts idiomatic `for (const [a, b] of query)` loops into optimized iteration over the entity graph
2. **System descriptor generation**: Infers `Read`/`Write` dependencies from type annotations, attaching `__system_desc` metadata

Systems using ECS query types in their parameters are detected and transformed automatically.

### Networking Architecture

Multiple entrypoints in `@glom/ecs`:
- `@glom/ecs` - Core ECS
- `@glom/ecs/replication` - State replication utilities
- `@glom/ecs/reconciliation` - Client-side prediction and rollback
- `@glom/ecs/command` - Command buffer for networked input

Key networking types:
- `ReplicationConfig`, `ReplicationStream` - Per-entity replication settings
- `HistoryBuffer` - Snapshot history for rollback
- `InputBuffer`, `IncomingSnapshots`, `IncomingTransactions` - Network message buffers

### Entity Graph

Entities are organized into an **entity graph** (`lib/glom-ecs/src/entity_graph.ts`) where nodes represent unique component signatures (archetypes). When an entity's components change, it moves to a different node. This enables:
- Fast iteration over entities with specific component sets
- Efficient `In`/`Out` monitoring for reactive systems

## Code Style

- Uses Biome for formatting/linting
- Double quotes, no semicolons, 2-space indent, no bracket spacing
- Test files are colocated as `*.test.ts`
- Benchmark files are colocated as `*.bench.ts`
