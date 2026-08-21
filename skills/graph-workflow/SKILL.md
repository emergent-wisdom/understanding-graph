---
name: graph-workflow
description: |
  Exact mutation, revision, relationship, and document-tree rules for the
  Understanding Graph. Use when persisting or changing graph state. This is a
  write-contract reference, not a required thinking loop.
user-invocable: false
---

# Graph Mutation Reference

The live MCP instructions and `understanding-work` define the fluid medium.
This skill only explains how to preserve a chosen update accurately. It does
not require orienting, searching, re-entering, or touching every tool in a
fixed order.

At a genuine choice point, `graph_suggest_next({ task, workflow })` can propose
concrete weighted routes. The model may choose, combine, change, reject, or
replace them. When a selected route calls `graph_understand`, keep its proposed
`stance`; workflow and stance are independent.

## Mutate atomically

Substantive graph changes go through `graph_batch`. A batch is one committed
encounter: either every operation succeeds or none does. It accepts at most
100 operations; split independent work into separate commits.

```javascript
graph_batch({
  commit_message: "Connected the new failure model to the observed retry burst",
  agent_name: "current-agent",
  operations: [
    { tool: "graph_add_concept", params: {
        title: "Fixed retries synchronize failure",
        trigger: "surprise",
        understanding: "A recovery rule that protects one client can align the population and intensify overload.",
        why: "Changes the failure model from independent retries to common-mode behavior"
    }},
    { tool: "graph_connect", params: {
        from: "$0.id",
        to: "n_retry_observation",
        type: "learned_from",
        why: "The burst trace is the evidence that occasioned this update"
    }}
  ]
})
```

`$N.id` references the result of operation N, counting every operation from
zero. Use the exact field names in the live schema. Common ones are:

```text
graph_add_concept  { title, trigger, understanding, why }
graph_note         { about, testimony, title?, trigger?, why?, status?, relations? }
graph_connect      { from, to, type, why }
graph_revise       { node, understanding, before, after, pivot, why }
doc_create         { title, content?, fileType?, isDocRoot?, parentId?, level?, afterId? }
doc_revise         { nodeId, content, why }
doc_move           { nodeId, parentId?, afterId? }
doc_split          { nodeId, mode, lineNumbers?, childLevel? }
```

Invalid fields and unavailable operations are rejected explicitly. Do not
guess aliases such as `edgeType`, `body`, or `source`/`target`.

Every batch also needs the real `agent_name`. For documents, a root uses
`isDocRoot: true`; a child uses `parentId`. When that parent already has
children, append with `afterId` set to the current tail, or to `$N.id` when the
tail was created earlier in the same batch.

New cognitive nodes in a non-empty graph need honest grounding to existing
material or a canonical document artifact. Document roots and structural
children may establish artifact structure without fabricated cognitive edges.
No node, trigger, edge, or rationale should be added merely to satisfy a shape
metric.

## Revision and disagreement

- Use `graph_revise` when the same position acquires a changed account and the
  before/pivot/after history matters.
- Use the dedicated batch operation `graph_supersede` when a newer position
  replaces an older one. Generic `graph_connect(type: "supersedes")` is
  rejected because supersession must archive the displaced node atomically.
- `contradicts` preserves a live conflict. It does not mean either endpoint is
  false and does not retire either one.
- `validates` and `invalidates` are signed evaluation outcomes.
- Ordinary revision preserves history. Administrative purge exists only on an
  explicitly broad local surface and is not a routine workflow.

## Relationship meanings

Direction is part of the claim. Prefer the most specific defensible relation;
use `relates` only when no narrower one is honest.

| Relation | Direction and meaning |
|---|---|
| `learned_from` | cognitive update → encountered evidence |
| `questions` | question or challenge → position questioned |
| `answers` | answer → question |
| `refines` | more precise update → prior account |
| `contradicts` | one live position → incompatible live position |
| `validates` / `invalidates` | evaluation → prediction or claim judged |
| `abstracts_from` | general model → concrete sources |
| `implements` | abstract commitment → concrete artifact realization |
| `expresses` | artifact unit → concept it renders |
| `inspired_by` | artifact unit → graph material reported as influential |
| `contains` / `next` | parent → child / earlier sibling → later sibling |

Every edge needs a truthful `why` saying what following it buys. Omit a
relation whose explanation would be invented after the fact.

## Triggers describe what an update became

Ordinary triggers are:

```text
foundation, surprise, repetition, consequence, tension, question, hypothesis,
serendipity, decision, experiment, analysis, model, randomness, reference,
library, prediction, evaluation
```

There is no trigger quota. Synthesis is usually visible in the inputs,
relations, and commit, while a stable result is typed by what it became.
`thinking` is reserved for the separate synthetic Reader/CMP mode and is never
an ordinary note.

## Artifact units remain addressable

In code, use document roots for files and ordered children for coherent imports,
types, functions, classes, tests, or blocks. In prose, roots and containers hold
works, parts, chapters, or scenes; leaves hold independently movable passages.
Granularity follows one meaningful center of attention, not lines, sentences,
word counts, or node quotas.

Change canonical document nodes, then regenerate projections. Do not repair a
generated file by hand. Use batch-only structural operations for split, move,
merge, and reorder so topology and projection stay consistent.

## Diagnostics are evidence, not targets

`graph_score`, `graph_practice`, and `graph_analyze` can reveal structural
risks. They do not measure truth, depth, or creativity. A sparse graph can be
useful; a dense graph can be empty ceremony. If no material understanding
changed, write nothing.
