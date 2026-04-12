---
name: graph-workflow
description: |
  Core graph mutation workflow: the five laws, typed edges, triggers, batches,
  variable references, and the full API reference. Use whenever working with the
  understanding graph — creating concepts, connecting nodes, revising beliefs,
  building document trees.
user-invocable: false
---

# Graph Workflow

## The graph is your working memory — use it for ALL substantial work

When the user asks you to do real work — coding, analysis, writing, problem-solving — the graph is how you think, not something you do afterward. Before writing a single line of code or prose:

1. **Search the graph** — `graph_semantic_search` for prior thinking on this topic. Don't start from zero.
2. **Search sema** (if available) — find patterns that structure the problem. A city optimizer is a `Strategy#47a4` problem with `Feedback#9b5c` loops. Name them.
3. **Commit your design decisions as concept nodes** — `decision` for approach chosen, `tension` for tradeoffs, `question` for unknowns. Do this BEFORE or ALONGSIDE writing code, not after.
4. **Write artifacts as doc trees** — code, prose, and analysis go in `doc_create` nodes inside the graph, connected to the concepts that motivated them.

**The pattern:** think → commit understanding → build → commit artifacts → connect them.

**Wrong:** user asks for code → you write a file → done. The graph was irrelevant.
**Right:** user asks for code → you search graph/sema → commit design decisions → write code as doc tree → connect code to decisions → the graph records WHY, not just WHAT.

This applies to everything, not just coding: research, analysis, creative writing, problem-solving. If the work is substantial enough to take more than one turn, it belongs in the graph.

## Correct graph_batch example — copy this pattern exactly

```javascript
graph_batch({
  operations: [
    { tool: "graph_add_concept", params: {
        title: "Example Concept",         // NOT name, NOT text
        trigger: "foundation",
        understanding: "What this means",  // NOT body, NOT content
        why: "Why this matters"
    }},
    { tool: "graph_connect", params: {
        from: "$0.id",                    // NOT source
        to: "n_existing_node",            // NOT target
        type: "refines",                  // NOT edgeType
        why: "Why these connect"
    }}
  ],
  commit_message: "what shifted in your understanding"
})
```

**Common mistakes that fail silently:** `name` (use `title`), `body` (use `understanding`), `source`/`target` (use `from`/`to`), `edgeType` (use `type`).

## The five laws

1. **Git for cognition.** Nodes are never deleted, only superseded. `graph_revise` with before/after/pivot captures the shift. The `why` is your commit message.
2. **The PURE standard.** Decision and analysis nodes must be **P**arsimonious, **U**nique, **R**ealizable, **E**xpansive. If any gate is red, reject.
3. **Graph-first context.** Search before creating. If >80% similar exists, extend it.
4. **Synthesize, don't transcribe.** Never record "user said X." Capture the implication — how it connects, what tension it creates.
5. **Delegate by default.** For substantial tasks, break into sub-tasks via `solver_delegate`.

## All mutations go through graph_batch

Every batch needs a `commit_message`. Batches are atomic. No orphans — every new concept must connect to at least one existing node in the same batch.

```javascript
// CORRECT
graph_batch({
  operations: [
    { tool: "graph_add_concept", params: { ... } },
    { tool: "graph_connect", params: { ... } }
  ],
  commit_message: "Your reflection on what you're adding and why"
})

// WRONG — fails
graph_add_concept({ ... })
```

## Required fields (strict — wrong parameters fail silently)

**`graph_add_concept`** — ALL four required:

| Parameter | What |
|-----------|------|
| `title` | Title of the concept (not ~~name~~, not ~~text~~) |
| `trigger` | One of the valid trigger enums |
| `understanding` | Your synthesis of this concept |
| `why` | Why this matters (min 3 chars) |

**`graph_connect`** — ALL four required:

| Parameter | What |
|-----------|------|
| `from` | Source node ID or variable reference (`$0.id`) |
| `to` | Target node ID |
| `type` | One of the valid edge type enums (not ~~edgeType~~) |
| `why` | Why this connection exists (min 3 chars) |

**`graph_revise`** — updating understanding:

| Parameter | What |
|-----------|------|
| `node` | Target node ID (not ~~nodeId~~) |
| `understanding` | New understanding (not ~~content~~) |
| `before` | What you believed before |
| `after` | What you believe now |
| `pivot` | What caused the shift |
| `why` | Why this revision matters |

## Variable references

Within a `graph_batch`, reference the result of earlier operations using `$N.id` (0-indexed):

```javascript
graph_batch({
  operations: [
    { tool: "graph_add_concept", params: { title: "Insight A", trigger: "surprise", understanding: "...", why: "..." }},
    { tool: "graph_add_concept", params: { title: "Insight B", trigger: "tension", understanding: "...", why: "..." }},
    { tool: "graph_connect", params: { from: "$0.id", to: "$1.id", type: "contradicts", why: "A and B are mutually exclusive" }}
  ],
  commit_message: "these two insights pull in opposite directions"
})
```

## Parameter name gotchas

| Tool | Parameter | Correct | WRONG |
|------|-----------|---------|-------|
| `graph_add_concept` | Title | `title` | ~~name~~, ~~text~~ |
| `doc_create` | Title | `title` | ~~text~~, ~~name~~ |
| `doc_create` | Hierarchy | `level` | ~~docType~~, ~~type~~ |
| `doc_create` | Content | `content` | ~~prose~~, ~~body~~ |
| `doc_revise` | Target | `nodeId` | ~~node~~, ~~id~~ |
| `doc_revise` | Content | `content` | ~~prose~~ |
| `doc_revise` | Reason | `why` | (required!) |
| `graph_revise` | Target | `node` | ~~nodeId~~ |
| `graph_revise` | Content | `understanding` | ~~content~~ |
| `graph_connect` | Edge type | `type` | ~~edgeType~~ |

## Typed edges — specific over generic

Every `graph_connect` must include an explicit `type`. `relates` is the fallback — reach for specific types first:

### Semantic edges

| Type | Use |
|------|-----|
| `supersedes` | Newer understanding replaces older |
| `contradicts` | Opposing ideas — one must yield |
| `diverse_from` | Different perspective — both valid |
| `refines` | Adds precision to existing concept |
| `implements` | Abstract → Concrete realization |
| `abstracts_from` | Concrete → Generalization |
| `contextualizes` | Provides framing for another concept |
| `questions` | Raises doubt about |
| `answers` | Resolves a question |
| `expresses` | Document → Concept it discusses |

### Epistemic edges

| Type | Use |
|------|-----|
| `learned_from` | Cognitive lineage: "I understood X by studying Y" |

### Predictive edges

| Type | Use |
|------|-----|
| `validates` | Later evidence confirms a prediction |
| `invalidates` | Later evidence refutes a prediction |

### Structural edges

| Type | Use |
|------|-----|
| `contains` | Parent → Child hierarchy |
| `next` | Sequential ordering |
| `relates` | General relationship (default fallback) |

**If you can't explain WHY two nodes connect in one sentence, don't connect them.**

## Diverse triggers

Don't collapse to `foundation` and `decision`. The full palette:

| Trigger | When to use | The cognitive act |
|---------|-------------|-------------------|
| `foundation` | Core concepts, axioms, starting points | Establishing bedrock |
| `surprise` | Unexpected findings, contradictions | Reality check |
| `tension` | Conflicts, trade-offs, unresolved issues | Holding opposing ideas |
| `consequence` | Implications, downstream effects | Foreseeing what follows |
| `repetition` | Patterns that recur across contexts | Identifying structural laws |
| `question` | Open questions, unknowns to explore | Defining the boundary |
| `decision` | Choice points, alternatives considered | Collapsing possibility |
| `experiment` | Empirical tests, validation attempts | Testing belief against reality |
| `analysis` | Agent-generated structured examination | Structured examination |
| `serendipity` | Chaos-injected insights | Unexpected connection |
| `thinking` | **RESERVED — synthesizer agent only.** Use `analysis` or `surprise` instead | — |
| `reference` | Pointer to another project or URL | Citation |
| `library` | Collection of references | Curated collection |
| `prediction` | Forward-looking belief | Forecasting |
| `evaluation` | Normative reflection | Value judgment |
| `hypothesis` | Explanatory theory | Provisional explanation |
| `model` | Generalized pattern | Abstraction |

## Commit messages: the metacognitive stream

Commit messages are visible to other agents via `graph_updates`. They see not just WHAT you created but WHY.

**Descriptive (BAD):**
- "Added tension node about conflict"
- "Connected X to Y"

**Reflective (GOOD):**
- "Something doesn't add up — the protagonist's calm feels forced"
- "I'm sensing a pattern: every mention of 'safety' precedes a failure"
- "This contradicts my earlier belief — updating my mental model"

## Substantive tasks get their own project

For real tasks: `project_create` + `project_switch` into a fresh project. Do all work there. When done, switch to `default` and plant one `reference` node pointing at the task project.

`default` is your long-term autobiography. Task projects hold reasoning for specific work.

## Document tools

### Creating documents

```javascript
graph_batch({
  operations: [
    { tool: "doc_create", params: {
        title: "Paper Title", level: "document",
        content: "# Introduction...", isDocRoot: true, fileType: "md"
    }},
    { tool: "doc_create", params: {
        title: "Methods", level: "section",
        content: "## Methods...", parentId: "$0.id"
    }},
    { tool: "doc_create", params: {
        title: "Results", level: "section",
        content: "## Results...", parentId: "$0.id", afterId: "$1.id"
    }}
  ],
  commit_message: "scaffolding paper structure"
})
```

### Navigating documents

| Goal | Tool |
|------|------|
| List all document roots | `doc_list_roots()` |
| See structure (no content) | `doc_get_tree({ rootId, brief: true })` |
| Context and location | `doc_navigate({ nodeId })` |
| Read content | `doc_read({ nodeId })` |
| Regenerate to file | `doc_generate({ rootId })` |

### Strategic reading pattern

Don't load entire documents. Navigate like a researcher:
1. `doc_list_roots()` — What documents exist?
2. `doc_get_tree({ rootId, brief: true })` — See structure
3. `doc_read({ nodeId })` — Read selectively
