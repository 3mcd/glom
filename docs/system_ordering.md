# System Ordering Rules

Systems in a `SystemSchedule` are automatically ordered using a Directed Acyclic Graph (DAG) and topological sorting based on their data dependencies. This ensures that data is produced before it is consumed and that conflicting access is handled predictably.

## Dependency Rules

Ordering is determined by the following rules:

1.  **Producer-Consumer (Write before Read)**: If System A writes to a component and System B reads from the same component, System A will always run before System B.
2.  **Multiple Writers**: If multiple systems write to the same component, they will run in their **registration order** (the order they were added to the schedule).
3.  **Tie-breaking (Registration Order)**: If there are no explicit dependencies between two systems, they will run in their registration order.

## Cycle Detection

If a circular dependency is detected (e.g., System A depends on System B, and System B depends on System A), an error will be thrown during the setup phase of the schedule with the message:
`"Cycle detected in system dependencies"`

## Example

```typescript
const s1 = define_system((a: Write<A>) => { ... });
const s2 = define_system((a: Read<A>, b: Write<B>) => { ... });
const s3 = define_system((b: Read<B>) => { ... });

const schedule = make_system_schedule();
add_system(schedule, s3);
add_system(schedule, s2);
add_system(schedule, s1);

// Even though they were added in reverse order (s3, s2, s1),
// they will be sorted to run as: s1 -> s2 -> s3
```

