# Glossary

<dl>
  <dt>Archetype</dt>
  <dd>a data structure that contains entities of like composition</dd>

  <dt>Component</dt>
  <dd>a data structure representing a property or state of an entity</dd>

  <dt>Continuous Predicted Simulation</dt>
  <dd>a networking model where clients run game logic immediately and correct it later if the server data is different</dd>

  <dt>DAG (Directed Acyclic Graph)</dt>
  <dd>a graph with no loops (Glom uses DAGs for ordering systems and organizing archetypes)</dd>

  <dt>Entity</dt>
  <dd>a 31-bit integer representing a discrete game unit</dd>

  <dt>Entity Graph</dt>
  <dd>a graph of archetypes used to update queries when entities change</dd>

  <dt>Entity Registry</dt>
  <dd>the part of the ECS that creates and tracks entity IDs</dd>

  <dt>Hi Bits</dt>
  <dd>the top 11 bits of an entity ID, used for the domain</dd>

  <dt>Lo Bits</dt>
  <dd>the bottom 20 bits of an entity ID, used for the local ID within a domain</dd>

  <dt>opSeq</dt>
  <dd>a counter used to ensure that changes are received and applied in the correct order</dd>

  <dt>Provenance</dt>
  <dd>the origin of an entity, identifying which agent created it</dd>

  <dt>SMI (Small Integer)</dt>
  <dd>a JavaScript engine optimization where small integers are stored more efficiently in memory</dd>

  <dt>System</dt>
  <dd>a function that contains logic and runs on entities that match a query</dd>

  <dt>Transaction</dt>
  <dd>a group of changes, such as spawning entities or updating components, that are applied together</dd>

  <dt>World</dt>
  <dd>the container for all entities and components in a game</dd>
</dl>
