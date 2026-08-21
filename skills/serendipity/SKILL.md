---
name: serendipity
description: |
  Explore distant graph material through grounded comparison, random
  perturbation, or temporary forced bisociation. Use when a live task could
  benefit from leaving its most familiar path without abandoning evidence.
user-invocable: true
allowed-tools: |
  mcp__plugin_understanding-graph_ug__graph_suggest_next
  mcp__plugin_understanding-graph_ug__graph_understand
  mcp__plugin_understanding-graph_ug__graph_analyze
  mcp__plugin_understanding-graph_ug__graph_practice
  mcp__plugin_understanding-graph_ug__graph_discover_grounded
  mcp__plugin_understanding-graph_ug__graph_random
  mcp__plugin_understanding-graph_ug__graph_semantic_search
  mcp__plugin_understanding-graph_ug__graph_path
  mcp__plugin_understanding-graph_ug__graph_history
  mcp__plugin_understanding-graph_ug__doc_list_roots
  mcp__plugin_understanding-graph_ug__graph_batch
---

# Serendipity

Serendipity is an encounter with material outside the most likely completion
path, followed by judgment. It is not a novelty quota, a claim that unrelated
things must connect, or permission to abandon the user's task.

## Choose the encounter

If the user has not requested a particular method and there is a genuine
exploratory choice, start with:

```javascript
graph_suggest_next({
  task: "State the live task or uncertainty",
  workflow: "general"
})
```

Replace `general` with the live work domain when reading, research, coding,
collaborative coding, or writing applies.

Consider higher-weighted routes seriously, then choose, combine, modify, or
reject them. The model decides whether a proposed encounter can serve the live
task; the menu is neither exhaustive nor mandatory. Do not call for another
roll merely because one turn elapsed.

Use `graph_discover_grounded({ nodes: 3, intensity: 0.2 })` when you want the
graph to sample distant material and ask whether a real bridge exists. Inspect
the actual sources, then look for a shared mechanism, constraint, structure, or
functional analogy. A defensible
no-connection result needs no node.

Use `graph_random({ nodes: 3, cold: true, force: false })` when the value lies in
letting a colder sample perturb the current framing. Returned nodes are
provocations, not premises. Re-enter selected material with
`graph_understand({ query, workflow, stance: "disrupt", focusNodeIds })` when
its surrounding evidence or resistance matters.

Use `graph_random({ nodes: 2, cold: true, force: true })` for a temporary
Physics What-If. For one generative pass, assume the sampled concepts connect
and articulate a possible mechanism. Then release the assumption, test it
against the task and sources, and preserve it only if a defensible relation
remains. “No connection” is a successful result.

## Let divergence affect the work

When an encounter materially changes the artifact, make that change in its
canonical graph document unit while Understanding mode is active. Preserve a
durable insight atomically with `graph_batch`, using a nested
`graph_serendipity` operation whose `source_elements` identify every source
node. Choose another honest cognitive type when the result is really a
question, surprise, hypothesis, tension, or decision.

If the encounter does not change later attention or work, write nothing.
Never create a note merely to prove that
the exploratory call was useful.
