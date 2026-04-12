---
name: creative-work
description: |
  Document trees and concept nodes — the two surfaces of the graph.
  Use when producing creative output — prose, code, analysis, papers —
  that should live in the understanding graph as doc trees.
user-invocable: false
---

# Creative Work — Two Surfaces

The graph holds two kinds of things and they **must stay separate**.

## Concepts vs Artifacts

- **Concepts** = typed nodes (`foundation`, `decision`, `surprise`, `tension`, `question`, `prediction`, `experiment`, `evaluation`, …). A few sentences capturing *why* and *what shifted*. **These are the thinking.** Every concept node is a captured cognitive moment.
- **Artifacts** = doc trees (`doc_create` with `fileType`, children carrying content). The actual thing you produced.

**Never mix.** Code and prose live in doc nodes. The reasoning *about* code — why this approach, what tradeoffs, what surprised you — lives in concept nodes.

## Pair concepts with artifacts

Every substantive `doc_create` should be accompanied by at least one concept node in the same batch — a `decision` for why this approach, a `tension` if an alternative still bothers you, a `question` if something's unresolved.

- **Wrong:** batch 1 = 3 doc_create ops; batch 2 = 6 concept nodes retroactively
- **Right:** batch 1 = `doc_create(strategy_1)` + `decision(why strategy_1)` + tension naming the rejected alternative

If you have 5+ consecutive `doc_create` ops with no concept node between, stop. You're filing results without capturing the reasoning that produced them.

## All creative output belongs in the graph

When you write prose, code, analysis, or any artifact the user asked for, create it via `doc_create` inside a `graph_batch` — not as a local file. The graph is the single source of truth; files are ephemeral projections generated on demand with `doc_generate`.

You may surface information directly to the user in your response — summaries, explanations, answers — but the graph must not be skipped.

## Doc tree mechanics

### Decompose files into child nodes

**Never put an entire file into one doc node.** A code file should look like:

```
engine (root, python)         ← imports, module docstring
├── DecompositionCore class   ← class definition + __init__
├── _extract_subconcepts      ← method body
├── _identify_relationships   ← method body
└── demo / main block         ← if __name__ == "__main__"
```

### Ordering with `afterId`

When a parent already has children, `doc_create` requires `afterId` pointing to the last existing sibling. Use `allowUnorderedDocs: true` on the batch to skip this if ordering doesn't matter.

### Revise existing docs, don't duplicate

Before creating a root doc, check `doc_list_roots`. If a doc covering the same subject exists — even under a different title — **revise it** with `doc_revise`. One root per functional purpose.

### Weaving documents to concepts

Always connect documents to what they discuss:

```javascript
graph_batch({
  operations: [
    { tool: "doc_create", params: { title: "Analysis", content: "...", isDocRoot: true }},
    { tool: "graph_connect", params: { from: "$0.id", to: "n_target_concept", type: "expresses", why: "this doc articulates the concept" }}
  ],
  commit_message: "weaving analysis doc into the concept web"
})
```

## Capture experiments

When you run code, the result is empirical data. Create an `experiment` node with: what you ran, the actual output, and what it means. Failed experiments are more valuable than successful ones.
