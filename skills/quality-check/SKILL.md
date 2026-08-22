---
name: quality-check
description: |
  Inspect graph structure when the user asks for a check or when a concrete
  structural problem may be affecting the work. Treat metrics as diagnostics,
  never as quotas or semantic-quality scores.
user-invocable: true
allowed-tools: |
  mcp__plugin_understanding-graph_ug__graph_score
  mcp__plugin_understanding-graph_ug__graph_analyze
  mcp__plugin_understanding-graph_ug__graph_thermostat
  mcp__plugin_understanding-graph_ug__graph_centrality
  mcp__plugin_understanding-graph_ug__graph_find_by_trigger
  mcp__plugin_understanding-graph_ug__graph_semantic_gaps
  mcp__plugin_understanding-graph_ug__graph_skeleton
  mcp__plugin_understanding-graph_ug__graph_suggest_next
  mcp__plugin_understanding-graph_ug__graph_discover_grounded
---

# Quality Check

Use this skill deliberately, not on a timer. Do not interrupt useful work for
scheduled maintenance, demand trigger diversity, or ask the user to repair the
graph merely because a number is low.

## Diagnose before changing

Choose the smallest view that answers the live question:

- `graph_analyze({ include: ["gaps", "bridges", "questions"] })` for islands,
  bridges, and genuinely unanswered questions;
- `graph_score()` for a compact structural snapshot;
- `graph_centrality()` when influence or bottlenecks matter;
- `graph_semantic_gaps()` when embedding coverage exists and conceptual
  distance is relevant;
- `graph_skeleton()` only when the overall topology is itself in question;
- `graph_thermostat()` as a legacy descriptive pulse, not a command.

Metrics describe the stored shape. They cannot establish truth, creativity,
importance, completeness, or whether a node was worth creating. A sparse graph
can be exactly right for a small task; a dense graph can still be confused.

## Judge the finding in context

- A disconnected region is a problem only if the work gives it a real relation
  to another region. Do not invent a bridge.
- An unanswered question may remain intentionally open.
- A contradiction is live conflict, not proof that either side is false.
- A low supersession count is not evidence that someone failed to reconsider.
- Trigger counts are descriptive. Never add questions, tensions, predictions,
  or any other type to improve a distribution.
- Artifact-heavy structure is an advisory signal only. Add cognitive testimony
  only when genuine understanding, uncertainty, evidence, or choice exists.

When a finding could materially affect the task, use
`graph_suggest_next({ task, workflow })` for concrete weighted routes or
`graph_discover_grounded()` for a bounded distant comparison. Choose, modify,
combine, or reject the result. “No defensible connection” and “no repair
needed” are valid outcomes.

## Repair only what is real

If the diagnosis identifies a genuine issue, make the smallest truthful change:

- connect regions with a specific typed relation;
- preserve an unresolved tension rather than forcing consensus;
- answer a question only when the graph now contains an answer;
- revise or use dedicated `graph_supersede` when a position actually changed;
- archive noise through the explicit lifecycle operation;
- leave healthy heterogeneity alone.

Explain the material finding to the user when it changes the work or needs
their judgment. Otherwise keep the check quiet and continue the task.
