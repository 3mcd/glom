# P2P Example

This example demonstrates a Peer-to-Peer synchronization model using Glom. 

Two independent Glom worlds are running in the same page, simulating two separate peers. They communicate by serializing and deserializing transactions and snapshots directly.

<div class="example"><iframe src="examples/p2p-canvas/" allow="pointer-lock"></iframe></div>

### Key Concepts

Each peer is assigned a unique ID (1 or 2) to prevent entity ID collisions across the network. Bi-directional replication ensures that any transactions recorded on one peer are immediately applied to the other. The example uses Glom's built-in reconciliation systems to handle state updates that arrive out of order.

### Controls

To control the blue square (Peer A), use the `W`, `A`, `S`, and `D` keys. For the red square (Peer B), use the arrow keys to move around the canvas.

