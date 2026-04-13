---
name: code-work
description: |
  Capturing reasoning traces from code work — decisions, experiments, surprises.
  Use when writing, debugging, or iterating on code alongside the understanding graph.
  The code lives in files; the graph captures WHY.
user-invocable: false
allowed-tools: |
  mcp__ug__graph_batch
  mcp__ug__graph_skeleton
  mcp__ug__graph_semantic_search
  mcp__ug__graph_find_by_trigger
  mcp__ug__graph_context
  mcp__ug__graph_history
  mcp__ug__graph_score
---

# Code Work — Reasoning Traces, Not Repositories

Code lives in files. The graph captures the **cognitive process** that produced it — the decisions, the rejected alternatives, the surprises, the experiments.

## Code vs creative-work

`creative-work` puts artifacts *inside* the graph as doc trees. Code-work is different: the code stays in the filesystem where it belongs. What enters the graph is the **understanding that shaped the code**.

- **Wrong:** `doc_create` with 200 lines of Python
- **Right:** `decision` node explaining why you chose reflecting boundaries over clamping, linked to the `surprise` node where you realized clamping creates boundary artifacts

## What belongs in the graph

### Decisions

Every time you choose one approach over another, that's a `decision` node. Not "I used Python" — that's obvious. The non-obvious choices: why this algorithm, why this data structure, why this boundary behavior.

```javascript
{ tool: "graph_add_concept", params: {
    title: "Reflecting boundaries over clamping",
    trigger: "decision",
    understanding: "Clamping concentrates probability density at boundary walls. Reflecting preserves the stochastic distribution while enforcing bounds.",
    why: "User's equation of motion uses bounded noise — boundary handling affects dynamics"
}}
```

### Surprises

When code behaves unexpectedly — a rendering overlaps, a test fails in a way you didn't predict, a performance characteristic surprises you — that's a `surprise` node. Failed expectations are more valuable than confirmed ones.

### Tensions

When two valid approaches conflict and you can't resolve which is better. "PCA projection sounds rigorous but produces meaningless coordinates" vs "LLM-as-mapper is honest but reintroduces the problem." Hold the tension — don't collapse it prematurely.

### Experiments

When you compile, run, render, or test — the result is empirical data. Create an `experiment` node with: what you ran, the actual output, and what it means. The compile-check-fix loop generates understanding; capture it.

## The iteration loop

Code work often follows a tight cycle: edit → run → observe → fix. Not every iteration deserves a node. Capture the **inflection points**:

1. **The initial approach** — a `decision` node
2. **When it breaks** — a `surprise` or `experiment` node
3. **When you change strategy** — a new `decision` that `supersedes` the old one
4. **When it finally works** — an `experiment` confirming the approach

Skip the mechanical middle. Six rounds of adjusting TikZ coordinates don't need six nodes — but the moment you realize the z-axis projection direction is the root cause, that's worth capturing.

## Connect to existing understanding

Code decisions don't happen in a vacuum. Link them:

- `learned_from` — "I understood boundary artifacts by studying the O-U process constraints"
- `supersedes` — "Reflecting boundaries replaces my earlier belief that clamping was sufficient"
- `answers` — "This experiment answers the question of whether PCA projection is viable"
- `contradicts` — "The rendered output contradicts my expectation that labels would be separated"

## Batch pattern

Pair code milestones with reasoning traces in the same batch:

```javascript
graph_batch({
  commit_message: "Chose reflecting boundaries for EAT phase space — clamping creates artifacts",
  operations: [
    // The decision
    { tool: "graph_add_concept", params: {
        title: "Reflecting boundaries over clamping",
        trigger: "decision",
        understanding: "...",
        why: "Clamping distorts probability density at manifold walls"
    }},
    // What it supersedes
    { tool: "graph_connect", params: {
        from: "$0.id", to: "n_prior_approach",
        type: "supersedes", why: "Clamping was the naive first attempt"
    }},
    // The experiment that confirmed it
    { tool: "graph_add_concept", params: {
        title: "Boundary behavior test",
        trigger: "experiment",
        understanding: "Compiled and rendered — reflecting boundaries produce clean distributions without wall accumulation",
        why: "Empirical confirmation of the theoretical concern"
    }},
    { tool: "graph_connect", params: {
        from: "$2.id", to: "$0.id",
        type: "answers", why: "Experiment validates the decision"
    }}
  ]
})
```

## What NOT to put in the graph

- The code itself — it's in files, versioned by git
- Mechanical edits — adjusting whitespace, fixing typos, renaming variables
- Build/compile output — unless the result was surprising
- Dependency versions — package.json is the source of truth

## When reviewing external code or suggestions

When evaluating someone else's code or an AI-generated suggestion (a PR, a Gemini revision, a Stack Overflow answer):

1. **What's genuinely useful?** → `foundation` nodes for new techniques learned
2. **What looks rigorous but isn't?** → `surprise` node for the gap between appearance and substance
3. **What would mislead a reviewer?** → `tension` between "sounds right" and "is right"

The reasoning about *why* you accept or reject a suggestion is more valuable than the suggestion itself.
