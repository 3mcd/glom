# P2P Example

This example demonstrates a Peer-to-Peer synchronization model using Glom. 

Two independent Glom worlds are running in the same page, simulating two separate peers. They communicate by serializing and deserializing transactions and snapshots directly.

<div class="example"><iframe src="examples/p2p-canvas/" allow="pointer-lock"></iframe></div>

### Key Concepts

- **Distributed Domain IDs**: Each peer has its own domain ID (1 and 2), preventing ID collisions.
- **Bi-directional Replication**: Transactions recorded on one peer are applied to the other.
- **Conflict Resolution**: Uses Glom's built-in reconciliation to handle out-of-order state updates.

### Controls
- **Blue Square (Peer A)**: Use `W`, `A`, `S`, `D` to move.
- **Red Square (Peer B)**: Use `Arrow Keys` to move.

