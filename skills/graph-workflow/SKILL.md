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

## Condition substantial work, then use its native workflow

The graph should alter attention and action when it carries relevant understanding.
It does not replace reading sources, requested prose files, or empirical
evidence; for coding, its document nodes intentionally are the source artifact.
Before substantial work, route the task explicitly:

| Work | `workflow` | Native authority | Specialized skill |
|------|------------|------------------|-------------------|
| Chronological source reading | `reading` | Source content and position | `reading-mode` |
| Single-contributor software work | `coding` | Code document nodes; generated tests/runtime | `code-work` |
| Concurrent software work | `collaborative_coding` | Owned code subtrees; generated integration tests | `collaborative-code` |
| Books, papers, stories, essays | `writing` | Requested draft or manuscript | `creative-work` |
| Other analysis or problem-solving | `general` | Task evidence | this skill |

Explicit skills never use `auto`. If no specialized workflow applies, call:

```javascript
graph_understand({ query: "the concrete task", workflow: "general" })
```

Then:

1. **Re-enter the process** — use returned priors, resistance, evidence, and
   unresolved momentum as orientation, not a checklist or authority.
2. **Check before creating** — `graph_semantic_search` for prior thinking on
   this topic. Don't start from zero or create a duplicate.
3. **Search sema** (if available) — find patterns that structure the problem. A city optimizer is a `Strategy#47a4` problem with `Feedback#9b5c` loops. Name them.
4. **Work in the native artifact** — read sources chronologically; author code
   in ordered document nodes and generate it for execution; or revise the
   requested manuscript.
5. **Capture living understanding at moments you choose** — preserve what
   genuinely becomes salient, including provisional observations, associations,
   alternatives, tensions, questions, hypotheses, predictions, evaluations,
   experiments, and later decisions.

**The pattern:** orient → attend openly → author a useful trace when something
moves → let it shape the native work → encounter evidence → revise → optionally
distill.

**Wrong:** user asks for code → edit a generated file and leave the graph stale.
**Right:** revise or rearrange the canonical code nodes, regenerate, run tests,
and connect the cognitive states that actually shaped or changed the code.

`no_shift` is a complete outcome. Do not create nodes merely to prove that the
graph was consulted.

## Make the invisible visible

At a self-selected Thought Moment, compose enough user-visible testimony for a
future instance to recover what drew attention, why it matters, which
alternatives remain alive, what you expect, and what the work might try next.
It may be rich, provisional, personal, unresolved, and longer than a summary.
Its purpose is to continue cognition, not decorate the graph.

When something stabilizes, ask: *what changed in my understanding just now?
What did I believe before, what encounter moved it, and what do I believe
after?* Preserve the richer trace that led there.

A node that says "this chapter discusses governance" is useless. A node that
says "I treated governance as rules; this passage instead supports
pattern-weaving" — with edges to the prior belief and the evidence that caused
the shift — is a trace future agents can inspect and test. If nothing changed,
`no_shift` is the right result and no new node is needed.

Do not pre-assign a note quota or march through trigger categories. Do not
claim access to hidden model computation or retroactively invent a clean
rationale. This is intentional cognitive testimony composed for continuation,
not private chain-of-thought.

Ordinary workflows never access or create `thinking` nodes. That trigger is
reserved for the separate synthetic Reader/CMP mode, which later reconstructs
chronological inner-voice training blocks from the underlying typed graph.
Reserved blocks and their incident relations are excluded from ordinary graph
context and mutation targets.

## STRICT parameter names — wrong names fail silently

```
graph_add_concept: { title, trigger, understanding, why }
graph_note:        { about, testimony, title?, trigger?, why?, status?, relations? } // graph_batch only
graph_connect:     { from, to, type, why }
graph_revise:      { node, understanding, before, after, pivot, why }
graph_serendipity: { name, synthesis, source_elements, why } // graph_batch only
graph_validate:    { node, insight }                         // graph_batch only
graph_decide:      { question, options, chosen, reasoning } // graph_batch only
doc_create:        { title, content, fileType, isDocRoot, parentId, level }
doc_move:          { nodeId, parentId?, afterId? } // graph_batch only
doc_split:         { nodeId, mode, lineNumbers?, childLevel? } // graph_batch, leaf only
```

For `graph_add_concept`, use `title` rather than `name`; `graph_serendipity`
intentionally uses `name`. Never substitute `body` for `understanding`,
`source`/`target` for `from`/`to`, or `edgeType` for `type`.

## Correct graph_batch example — copy this pattern exactly

```javascript
graph_batch({
  operations: [
    { tool: "graph_add_concept", params: {
        title: "Example Concept",
        trigger: "foundation",
        understanding: "What this means",
        why: "Why this matters"
    }},
    { tool: "graph_connect", params: {
        from: "$0.id",
        to: "n_existing_node",
        type: "refines",
        why: "Why these connect"
    }}
  ],
  commit_message: "what shifted in your understanding"
})
```

## The five laws

1. **Git for cognition.** Nodes are never deleted, only superseded. `graph_revise` with before/after/pivot captures the shift. The `why` is your commit message.
2. **The PURE standard.** Apply PURE after open exploration, when an analysis,
   model, synthesis, or decision is being stabilized for reuse. Never use it to
   suppress raw surprise, questions, tension, or hypotheses before they develop.
3. **Graph-first context.** Use `graph_understand` before answering and search
   before creating. If >80% similar exists, extend it.
4. **Synthesize, don't transcribe.** Never record "user said X." Capture the implication — how it connects, what tension it creates.
5. **Delegate along real seams.** Parallelize independent work. For concurrent
   code-subtree edits, use `collaborative-code` so ownership, locks, handoffs, and
   integration are explicit.

### Synthesis is an operation, not a catch-all trigger

Synthesis happens throughout the graph. Make it visible through the several
typed inputs, their edge rationales, and the atomic commit that integrates
them. Type the result by what the synthesis becomes: `analysis` for a
stabilized view or deliberate suspension, `model` for a general mechanism,
`hypothesis` for a provisional unification, `decision` for a choice,
`evaluation` for a value judgment, `serendipity` for an unexpected bridge,
`tension` for an irreducible conflict, or `question` for the unknown the
attempt exposed. Do not hide this distinction behind a generic synthesis node.
The mutating helpers `graph_serendipity`, `graph_validate`, and `graph_decide`
are operations inside `graph_batch`, never top-level calls.

## Direct concept and document-tree mutations go through graph_batch

Every batch needs a `commit_message`. Batches are atomic. No orphans — every
new concept must connect to at least one existing node in the same batch.
Workflow tools such as `source_read` manage their own atomic updates.

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
| `analysis` | Stabilized integration or structured examination | Cognitive ratchet |
| `serendipity` | Chaos-injected insights | Unexpected connection |
| `thinking` | **RESERVED — synthetic Reader/CMP synthesizer only.** Never ordinary notes | Reconstructed training block |
| `reference` | Pointer to another project or URL | Citation |
| `library` | Collection of references | Curated collection |
| `prediction` | Forward-looking belief | Forecasting |
| `evaluation` | Normative reflection | Value judgment |
| `hypothesis` | Explanatory theory | Provisional explanation |
| `model` | Generalized pattern | Abstraction |

### Metabolizing information

Don't just "log" events. Metabolize raw inputs into structured understanding:

| When you feel… | Create | The cognitive act |
|-----------------|--------|-------------------|
| "This conflicts with X" | `tension` | **Synthesis** — holding two opposing ideas |
| "Wait, that's weird…" | `surprise` | **Update** — reality check against mental model |
| "So therefore…" | `consequence` | **Projection** — foreseeing downstream effects |
| "I don't get X…" | `question` | **Curiosity** — defining the boundary of understanding |
| "We've been here before" | `repetition` | **Pattern recognition** — identifying structural laws |
| "I choose X because…" | `decision` | **Agency** — collapsing possibility into commitment |

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

For real tasks, call `project_switch({ project, goal })`; it creates the project
when needed. Do all work there. When done, switch to `default` and plant one
`reference` node pointing at the task project.

`default` is your long-term autobiography. Task projects hold reasoning for specific work.

### Generated file path rules
When using `doc_generate`, the file name is derived from the document root's title:
- Title is hyphenated and lowercased: "My Paper Title" → `my-paper-title.md`
- `fileType` determines the extension. A matching extension in the title is
  accepted and de-duplicated; using a filename stem is simplest.
- Example: title "Analysis Report", fileType "md" → `analysis-report.md`

### Choosing edge types — decision tree
`relates` is the fallback. Before using it, run through this decision tree:
- New decision that builds on prior foundation → `refines`
- Two strategy alternatives that can't both be true → `contradicts`
- Later evidence confirms a prediction → `validates`
- Later evidence refutes a prediction → `invalidates`
- Newer understanding replaces older → `supersedes`
- Abstract concept made concrete → `implements`
- Concrete observation generalized → `abstracts_from`
- "I understood X by studying Y" → `learned_from`
- Document discusses a concept → `expresses`
- Raises doubt → `questions`; resolves doubt → `answers`

If none of these fit, `relates` is fine — but most edges have a more specific type.

### Red flags in batches
Watch for these patterns that indicate shallow graph work:
- **Editing generated code** — the executable projection changed without the
  canonical document nodes changing.
- **Only `doc_create` operations in a graph-native writing batch** — you're
  filing a manuscript without capturing any durable change in understanding.
- **Every `graph_connect` uses `relates`** — shallow linking. Run through the edge decision tree above.
- **Zero sema handles in understanding text** — you're thinking without shared vocabulary. Search sema before substantive batches.
- **Monolithic content** — a single massive node instead of decomposed thinking. Break large insights into connected smaller nodes.
- **No questions or tensions** — you're only recording conclusions, not the doubt and conflict that led there.

## Document tools

Use document tools for graph-native code, manuscripts, reading journals, and
other artifacts whose canonical home is the graph. Code document roots are the
source of truth; generated files are projections. Do not duplicate an existing
file-based draft merely to satisfy the workflow.

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

### Rearranging documents

Use `doc_move` only as an operation inside `graph_batch`:

```javascript
graph_batch({
  operations: [
    { tool: "doc_move", params: {
        nodeId: "n_section", parentId: "n_destination_parent",
        afterId: "n_previous_sibling"
    }}
  ],
  commit_message: "moved the section where its premise is established"
})
```

`parentId` defaults to the current parent. `afterId` means the direct previous
sibling under the destination parent; omit it to place the subtree first. The
operation preserves the node/subtree content and history, atomically repairs
both parents' `contains`/`next` topology, rejects roots, cycles, malformed
orders, and foreign `afterId` values, then regenerates affected roots. Do not
call it directly or manually rewire document order edges.

Use `doc_split` inside `graph_batch` when one leaf document unit contains more
than one independently meaningful unit. In writing, that means more than one
local creative center—not a size quota. It retains the node as an empty
container, preserves the former content in revision history, and creates one
validated child sequence. A node that already has children must be reworked
through those children rather than split into a competing sequence. In line
mode, use unique zero-based boundaries from 1 through the line before the end;
for prose, choose `childLevel: "paragraph"` or `"sentence"` when headings would
be wrong. Do not pass `keepParent`, `asFiles`, or `project`.

### Strategic reading pattern

Don't load entire documents. Navigate like a researcher:
1. `doc_list_roots()` — What documents exist?
2. `doc_get_tree({ rootId, brief: true })` — See structure
3. `doc_read({ nodeId })` — Read selectively
