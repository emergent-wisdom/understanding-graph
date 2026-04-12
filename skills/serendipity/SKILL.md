---
name: serendipity
description: |
  Grounded and pure serendipity workflows for injecting novelty.
  Use when the graph feels too tight, the thermostat says DIVERGE,
  or you want to break creative blocks.
user-invocable: true
allowed-tools: |
  mcp__ug__graph_discover
  mcp__ug__graph_chaos
  mcp__ug__graph_batch
  mcp__ug__graph_skeleton
  mcp__ug__graph_semantic_search
  mcp__ug__graph_thermostat
  mcp__ug__graph_context
---

# Serendipity

## Grounded serendipity

`graph_discover_grounded({ nodes: 3, intensity: 0.2 })` — random nodes with a real bridge.

Two-phase protocol:
1. System provides random nodes → you find the **real bridge** (shared substrate or functional analogy)
2. System injects noise into your bridge → you rationalize the corruption into new territory

**Phase 1: Sense-Making** — find the real bridge before inventing. Look for structural analogies, shared mechanisms, or conceptual overlaps between the random nodes.

**Phase 2: Chaos Perturbation** — the system corrupts your bridge statement. Your job is to treat the corruption as an axiom and invent new theory from it.

Use grounded serendipity for lasting theory. The result should be a `serendipity` or `surprise` node connected to the source nodes.

## Pure serendipity

`graph_serendipity()` — high novelty, lower coherence.

The serendipity engine forces unexpected connections through enforced blindness:
- `graph_discover` returns ONLY a prompt — the blind agent doesn't see source nodes
- The blind agent treats corrupted seeds as axioms and invents physics
- Cold nodes (rarely accessed) are prioritized for unexpected combinations

Use pure serendipity for breaking blocks.

## When to use

- Thermostat says DIVERGE
- Graph density is high (tight mental model needs disruption)
- You're stuck in a rut
- The same triggers keep appearing (too much `foundation` and `decision`)

## Follow through

**Divergence is not decoration.** If `graph_discover_grounded` returns a genuine bridge, the next batch must write a `serendipity` or `surprise` node about it. A divergent tool call with no follow-up commit is looking at shiny objects.
