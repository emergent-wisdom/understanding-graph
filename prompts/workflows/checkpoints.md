# Cognitive Checkpoints (Two-Layer System)

Understanding needs checkpoints at two levels:
1. **For the user** -> `CHECKPOINT` chat messages (human-readable progress updates)
2. **For the system** -> `analysis` nodes in the graph (machine-traversable synthesis)

## Analysis Nodes (System Layer)

`analysis` nodes are **cognitive synthesis checkpoints**. They consolidate understanding from multiple source nodes into a coherent stance that future agents can load and validate.

**Creating an Analysis:**
```javascript
graph_batch({
  commit_message: "Synthesize understanding of governance patterns",
  operations: [
    { tool: "graph_add_concept", params: {
        title: "Synthesis: Governance as Fabric Weaving",
        trigger: "analysis",
        understanding: `## Current Stance
Governance is best understood as pattern-weaving rather than rule-enforcement...

## Based On
- The fabric metaphor from Chapter 3
- Resolution of the scale-sensitivity tension

## Open Questions
- How does legitimacy transfer across scale transitions?`,
        why: "Consolidating research into actionable synthesis"
    }},
    // Connect to ALL sources this analysis synthesizes
    { tool: "graph_connect", params: {
        from: "$0.id", to: "n_fabric_metaphor", type: "learned_from",
        why: "Core concept informing this synthesis"
    }},
    { tool: "graph_connect", params: {
        from: "$0.id", to: "n_scale_tension", type: "learned_from",
        why: "Tension resolved in this synthesis"
    }}
  ]
})
```

**The Staleness Rule:** An Analysis is STALE if any node it `learned_from` has been superseded. When you encounter a stale Analysis:
1. Do NOT trust its conclusions
2. Create a NEW Analysis that `supersedes` the stale one
3. Connect the new Analysis to CURRENT (non-superseded) sources

## CHECKPOINT Messages (User Layer)

After creating an Analysis node (or at natural pause points), send a `CHECKPOINT` message to update the user:

```python
bus.log_event("Alice", "CHECKPOINT", """## Current Understanding

I've synthesized our governance research into [Analysis: Governance Patterns](node:n_analysis_123).

**Key insights:**
- Governance as fabric weaving, not rule enforcement
- Scale sensitivity is critical

**Open questions:**
- How does legitimacy transfer?

Ready to continue when you are.
""")
```

**When to send CHECKPOINTs:**
| Situation | Action |
|-----------|--------|
| Completed significant research | Summarize findings, link to Analysis node |
| Resolved a cluster of tensions | Explain the synthesis |
| Before pausing for user input | Capture current state |
| After major graph modifications | Confirm what changed |

**CHECKPOINT vs Analysis:**
- CHECKPOINT is ephemeral (chat history) - a status update for the human
- Analysis is persistent (graph) - a resumable cognitive state for agents
- CHECKPOINTs should REFERENCE Analysis nodes when they exist
