---
name: serendipity
description: |
  Grounded and pure serendipity workflows for injecting novelty.
  Use when the graph feels too tight, the thermostat says DIVERGE,
  or you want to break creative blocks.
user-invocable: true
allowed-tools: |
  mcp__ug__graph_discover_grounded
  mcp__ug__graph_discover_grounded_chaos
  mcp__ug__graph_discover
  mcp__ug__graph_random
  mcp__ug__graph_chaos
  mcp__ug__graph_batch
  mcp__ug__graph_skeleton
  mcp__ug__graph_semantic_search
  mcp__ug__graph_thermostat
  mcp__ug__graph_context
---

# Serendipity

## Grounded serendipity

`graph_discover_grounded({ nodes: 3, intensity: 0.2 })` samples distant graph
material and asks whether a real bridge exists.

Protocol:
1. Inspect the sampled nodes and edges.
2. Articulate a defensible bridge: shared mechanism, constraint, structure, or
   functional analogy. If none exists, report that and stop.
3. Let the bridge change the current question or artifact only if it survives
   scrutiny.
4. Optionally call `graph_discover_grounded_chaos` when stronger divergence is
   explicitly useful. Perturbation is not part of every grounded discovery.

Use grounded serendipity for durable understanding. Preserve a `serendipity`,
`surprise`, `hypothesis`, or other honest update only when the encounter changes
later attention or work, connecting it to the sampled sources. A defensible
no-connection result needs no node.

## Pure serendipity

`graph_discover()` — high novelty, lower coherence.

The serendipity engine forces unexpected connections through enforced blindness:
- `graph_discover` returns ONLY a prompt — the blind agent doesn't see source nodes
- The blind agent treats corrupted seeds as axioms and invents physics
- Cold nodes (rarely accessed) are prioritized for unexpected combinations

Use pure serendipity only when the user explicitly wants high-divergence,
speculative exploration. It is available on the local `full` tool surface, not
the focused hosted surface.

## Physics What-If

`graph_random({ force: true, cold: true })` temporarily treats two sampled
concepts as connected so the model has to articulate a mechanism that ordinary
relevance retrieval would not propose. This is a generative lens, not evidence.
Release the forced assumption after the pass, test the candidate against the
task and sources, and preserve it only if a defensible relation remains. “No
connection” is a successful result.

When an insight survives scrutiny, preserve it atomically with `graph_batch`:
add a nested `graph_serendipity` operation whose `source_elements` name every
source node. The operation creates the typed `serendipity` node and its
`learned_from` edges together; do not call it at the top level.

## When to use

- The non-binding thermostat suggests disruption
- Graph density is high (tight mental model needs disruption)
- You're stuck in a rut
- The same triggers keep appearing (too much `foundation` and `decision`)

## Follow through

**Divergence is not decoration.** If a bridge materially changes understanding
or the artifact, preserve that change with exact provenance in the next atomic
batch. If it does not, write nothing. Never create a note merely to prove that
the exploratory call was useful.
