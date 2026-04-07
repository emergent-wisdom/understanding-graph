# Serendipity Engine (Inverse Hallucination)

The serendipity engine forces unexpected connections through **enforced blindness**:

1. `graph_discover({ nodes: 2, cold: true, blind: true })` -> returns ONLY a prompt
2. Spawn a **separate blind agent** with just that prompt
3. The blind agent must treat the corrupted seeds as **axioms** and invent physics to explain them
4. Commit synthesis: `graph_add_concept({ trigger: "serendipity" })`

## Why Blind?

Without it, you see source nodes and map seeds back to known meanings. Blind forces genuine invention - you must explain WHY these random concepts ARE connected, not how they might be.

## Cold Nodes

Prioritize rarely-accessed nodes - they're more likely to yield unexpected combinations.
