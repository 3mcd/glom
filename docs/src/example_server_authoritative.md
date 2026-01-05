# Server-Authoritative Example

This example demonstrates a server-authoritative model with client-side prediction and server reconciliation.

The simulation below runs both a "Server" world and a "Client" world. The client sends movement commands to the server, predicts the results locally, and then reconciles its state when the authoritative server response arrives after a simulated latency.

<div class="example"><iframe src="examples/server-authoritative-canvas/"></iframe></div>

### Key Concepts

- **Command Recording**: The client records move commands instead of directly modifying state.
- **Client Prediction**: The client applies commands immediately to its local world for zero-latency feedback.
- **Rollback & Reconciliation**: When server transactions arrive, the client rolls back its local history and re-simulates to ensure it matches the server's authority.
- **Lag Compensation**: The server handles commands based on the tick they were issued by the client.

### Controls
- **Movement**: Use `W`, `A`, `S`, `D` to move.
- **Action**: Use `Space` to emit a pulse (spawned on server).

