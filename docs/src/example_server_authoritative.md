# Server-Authoritative Example

This example demonstrates a server-authoritative model with client-side prediction and server reconciliation.

The simulation below runs both a "Server" world and a "Client" world. The client sends movement commands to the server, predicts the results locally, and then reconciles its state when the authoritative server response arrives after a simulated latency.

<div class="example"><iframe src="examples/server-authoritative-canvas/" allow="pointer-lock"></iframe></div>

### Key Concepts

The example client records movement commands instead of directly modifying state. With **Client Prediction**, these commands are applied immediately to the local world for zero-latency feedback. When server transactions eventually arrive, **Rollback & Reconciliation** allows the client to roll back its local history and re-simulate to match the server's authority. Additionally, **Lag Compensation** ensures the server handles commands based on the specific tick they were issued by the client.

### Controls

Use the `W`, `A`, `S`, and `D` keys to move. You can also predictively spawn an entity by pressing `Space`.


