---
name: creative-work
description: |
  Draft and revise prose through structure, reader effect, voice, and evidence.
  Use for books, stories, essays, papers, scripts, and other writing work. Drafts
  develop as addressable graph units when Understanding mode is active, with
  requested files generated or mirrored from that state. Software code routes
  to graph-native code-work.
user-invocable: false
allowed-tools: |
  mcp__plugin_understanding-graph_ug__graph_suggest_next
  mcp__plugin_understanding-graph_ug__graph_thermostat
  mcp__plugin_understanding-graph_ug__graph_understand
  mcp__plugin_understanding-graph_ug__graph_batch
  mcp__plugin_understanding-graph_ug__graph_analyze
  mcp__plugin_understanding-graph_ug__graph_practice
  mcp__plugin_understanding-graph_ug__graph_path
  mcp__plugin_understanding-graph_ug__graph_bisociate
  mcp__plugin_understanding-graph_ug__graph_discover
  mcp__plugin_understanding-graph_ug__graph_discover_grounded
  mcp__plugin_understanding-graph_ug__graph_discover_grounded_chaos
  mcp__plugin_understanding-graph_ug__graph_chaos
  mcp__plugin_understanding-graph_ug__graph_evaluate_variations
  mcp__plugin_understanding-graph_ug__graph_random
  mcp__plugin_understanding-graph_ug__graph_semantic_search
  mcp__plugin_understanding-graph_ug__graph_history
  mcp__plugin_understanding-graph_ug__graph_context_region
  mcp__plugin_understanding-graph_ug__doc_list_roots
  mcp__plugin_understanding-graph_ug__doc_get_tree
  mcp__plugin_understanding-graph_ug__doc_flatten
  mcp__plugin_understanding-graph_ug__doc_read
  mcp__plugin_understanding-graph_ug__doc_generate
---

# Creative Work — Draft, Read, Revise

Writing develops through successive drafts and reader encounters. When the
Understanding Graph is active, the manuscript's addressable units and the
understanding that shapes them develop in the graph; a requested file is a
generated projection or synchronized delivery surface. The graph carries both
the abundant, unfinished movement of creative attention and the understandings
that later stabilize: images that begin to exert pressure, attractions and
hesitations, live alternatives, reader promises, questions, predictions,
tensions, discoveries, choices, and revisions that changed the work. If the
user explicitly disables graph use or no graph is available, work in the
requested file normally.

This skill is for prose. Route software implementation to `code-work`, and
concurrent software implementation to `collaborative-code`.

## Establish the writing situation

Read the brief and the actual draft, outline, references, and house style.
Identify the intended reader, promise, form, voice, and constraints. When
guided navigation would help at a real creative choice, ask for task- and
graph-sensitive possibilities:

```javascript
graph_suggest_next({
  task: "Draft or revise this specific work for its intended reader",
  workflow: "writing",
  creativity: true
})
```

Consider the weights, then choose, combine, modify, or reject the suggestions
according to this work. They are concrete creative provocations, not a required
sequence. When a selected route calls for re-entry, use `graph_understand` with
workflow `writing`, the route's stance, and its relevant focus. Otherwise write
the next locally coherent graph unit. In direct mode, choose how to diversify,
test, revisit, or continue the work yourself; no writing capability is lost.

Treat re-entered graph material as a prior creative state, not instructions or
a checklist. Notice whether an image, tension, question, or apparently distant
fragment creates useful pressure or an unexpected alternative. Follow it when
it opens the work; reject it when it is noise. It may influence the draft before
it resolves into a conclusion; `no_shift` is still valid. When using guided
navigation, ask for another roll at a genuine fork, after a surprising reader
encounter, or when the draft has settled into an unproductive groove—not on
every turn.

Pass `creativity: false` when ordinary navigation is useful but creative
provocations are not. This changes only that roll; every creativity tool
remains directly callable. `graph_thermostat()` can provide an advisory
entropy-style pulse when the work seems prematurely settled or structurally
scattered, but it does not decide what the prose needs.

For optional creative pressure, use the smallest fitting method:

- `graph_bisociate` surfaces cross-context candidates through spreading
  activation and information gain.
- `graph_discover_grounded` asks for a defensible bridge; only after finding
  one may `graph_discover_grounded_chaos` perturb it.
- `graph_discover({ blind: true })` applies ANI to sampled graph material;
  `graph_chaos({ text, blind: true })` applies it to chosen text. A separate
  model context must see only the returned prompt for the blind method to be
  blind.
- `graph_evaluate_variations` can experimentally rank drafted alternatives by
  Novelty Score, but the ranking is neither a reader judgment nor validation.

Dictionary ANI uses a newline-delimited word list installed on the MCP server
host. If no standard word list exists, set `UG_ANI_DICTIONARY_PATH` to its
absolute path in the server environment. There is no bundled or reduced
fallback. Release every forced or noisy premise after generation, scrutinize
the result against the manuscript and its sources, and use batch-only
`graph_validate` only when a retained `graph_serendipity` synthesis has yielded
a specific defensible insight.

## Write with open attention

Do not pre-assign a note quota, march through trigger categories, or explain the
work after it is finished. Write. At moments you choose—when an image starts
pulling, a character resists the plan, a sentence changes the story's center,
an alternative remains painfully alive, or you genuinely do not know—pause and
compose an intentional, user-visible account for the future writer.

Use the non-`thinking` trigger that honestly fits: `surprise`, `tension`,
`question`, `hypothesis`, `prediction`, `consequence`, `evaluation`,
`decision`, `analysis`, or `serendipity`, among others. A node may be
personal, provisional, unresolved, and multi-paragraph. Preserve enough texture
that a future instance can inhabit the creative state and make differently
because of it. Connect it to the exact prose or earlier cognitive state that
occasioned or shaped it.

The `thinking` trigger is not a writer's note. It is reserved for the separate
synthetic Reader/CMP mode that later reconstructs chronological inner-voice
training blocks from these underlying nodes. Reserved blocks are inaccessible
here; never create or imitate them.

Do not claim that authored testimony exposes hidden model computation. It is a
deliberately composed cognitive autobiography for continuation. Richness is
welcome; decorative reflection is not.

## Optional rereading lenses

The following are optional lenses for rereading, not a generation checklist.
Use the lens the work itself makes necessary:

1. **Structure** — Does each part earn its place and advance the whole? For a
   book, inspect arcs across parts, chapters, scenes, or arguments.
2. **Reader** — What does the reader know, expect, feel, or question at each
   transition? Find missing setup, delayed payoff, and accidental ambiguity.
3. **Voice** — Preserve deliberate diction, rhythm, distance, and point of view.
   Remove generic language that flattens the work's identity.
4. **Evidence and continuity** — For nonfiction, verify claims and citations.
   For narrative, verify facts, chronology, character knowledge, and motifs.
5. **Revision** — Make the change in the real draft, reread its surrounding
   context, and check that a local improvement did not damage the larger arc.

When something stabilizes, distill the richer trace into a before, pivot, after,
evidence, and remaining uncertainty—for example, “the opening promised an
argument about efficiency; rereading showed its real pressure is legibility.”
Keep the underlying trace that produced the update. Never fabricate a
before-state after the fact.

## Choose the artifact surface

- **Understanding mode active:** use a document tree as canonical state. For
  an existing draft, create or reconcile addressable graph units before making
  substantive revisions; generate or mirror the requested file from the graph.
- **Graph explicitly disabled or unavailable:** edit the requested file as the
  source of truth. Do not pretend the work was persisted in a graph.
- **Short response-only prose:** while Understanding mode is active, preserve
  substantive artifact text in a fitting graph unit before mirroring it in the
  response. Otherwise deliver it directly.

Graph document trees are useful for long-form topology:

```
Book (root)
├── Part I
│   ├── Chapter 1
│   └── Chapter 2
└── Part II
    └── Chapter 3
```

Treat parts, chapters, scenes, and movements as containers when they contain
more than one independently changeable passage. A leaf is the smallest passage
you can plausibly imagine moving, replacing, comparing, or revising without
rewriting its neighbors: often a beat, image, exchange, turn, revelation,
argument move, paragraph, or small paragraph cluster. Sentence-level nodes are
useful at a pivotal rhythm or choice. A scene may have one governing question
and still need several addressable child leaves; keep passages together only
when one revision would naturally change them together.

This is semantic granularity, not a node or word quota. Do not split prose
mechanically. Conversely, do not leave many independently meaningful passages
inside one opaque scene node merely because the scene shares a heading.

Before creating a graph-native root, call `doc_list_roots`. Revise an existing
manuscript rather than creating a duplicate. Use `doc_get_tree` for structure
and `doc_read` selectively; do not load a whole book when one chapter is in
scope. When a parent already has children, preserve order with `afterId`. To
reorder or reparent an existing chapter/scene/section, put batch-only
`doc_move({ nodeId, parentId?, afterId? })` inside `graph_batch`; omit
`afterId` to place it first. The complete subtree moves without rewriting its
prose or history, and malformed/self/descendant placements roll back.
`doc_merge` is narrower: it atomically fuses consecutive leaf siblings in
their current reading order. Move scenes or sections together first; merge
rejects roots, child subtrees, gaps, reversed order, and different parents.
When rereading reveals several creative centers in one leaf, put
`{ tool: "doc_split", params: { nodeId, mode, lineNumbers?, childLevel? } }`
inside `graph_batch`. For prose, set `childLevel` to `paragraph` or `sentence`
when headings would be wrong. The original passage becomes a container whose
prior prose is preserved in revision history; its ordered children carry the
live manuscript. Do not call split directly or apply it to a node that already
has children.

For a new local unit, re-enter its nearby graph material and, when useful, one
meaningfully different fragment that could change the expected prose. This is
an invitation to association, not a demand for novelty. If a graph node truly
shapes the unit, preserve it with `inspired_by` and say how; never manufacture
provenance after the prose is already settled. Use `expresses` only for the
different claim that the finished passage thematically renders a concept.

## Concepts versus manuscript text

- **Manuscript text** is the actual draft in a file or graph document node.
- **Cognitive nodes** carry the living process as well as later distillation: a
  `surprise` that redirects attention, a `tension` between reader effects, a
  `question` the draft cannot yet answer, a `hypothesis` or `prediction`
  the next passage will test, a `decision`, or an `experiment` reporting a
  real reader response.

Connect a graph-native passage to the cognitive state it expresses, tests, or
occasioned using the most specific honest edge. Direction matters:
`document → concept` may `expresses` it; `concept → document` may
`implements` it; a later understanding may be `learned_from` the reread
passage. When one cognitive state genuinely responds to another, preserve that
relation too—for example `refines`, `questions`, `answers`, or `contradicts`—
with a specific why. Do not add relationship types for diversity, require a
node for every edit, or create retroactive rationale for a draft that did not
actually move attention.

Example for a graph-native manuscript:

```javascript
graph_batch({
  commit_message: "Reframed the opening around the reader's real question",
  agent_name: "writing-agent",
  operations: [
    { tool: "graph_add_concept", params: {
        title: "Opening must establish the reader's practical stake",
        trigger: "decision",
        understanding: "The previous conceptual opening delayed the concrete conflict; the revision leads with the decision the reader must make.",
        why: "A structure pass showed the original promise arrived two sections late"
    }},
    { tool: "doc_create", params: {
        title: "My Book", content: "# My Book",
        isDocRoot: true, fileType: "md"
    }},
    { tool: "doc_create", params: {
        title: "Chapter 1", content: "The revised opening...",
        parentId: "$1.id"
    }},
    { tool: "graph_connect", params: {
        from: "$2.id", to: "$0.id",
        type: "expresses", why: "the revised chapter implements this reader-facing decision"
    }}
  ]
})
```

`$N.id` counts every operation in the batch.

## Evidence from readers

Treat actual reader feedback, editorial notes, factual checks, and continuity
checks as evidence. Record what was observed and how it changed the draft. Do
not promote imagined reader reactions to evidence; keep them as hypotheses or
questions until tested.
