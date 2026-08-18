---
name: creative-work
description: |
  Draft and revise prose through structure, reader effect, voice, and evidence.
  Use for books, stories, essays, papers, scripts, and other writing work. Drafts
  live in the user's requested files by default; graph document trees are an
  optional writing surface. Software code routes to graph-native code-work.
user-invocable: false
allowed-tools: |
  mcp__ug__graph_understand
  mcp__ug__graph_batch
  mcp__ug__graph_semantic_search
  mcp__ug__graph_history
  mcp__ug__graph_context_region
  mcp__ug__doc_list_roots
  mcp__ug__doc_get_tree
  mcp__ug__doc_flatten
  mcp__ug__doc_read
  mcp__ug__doc_generate
---

# Creative Work — Draft, Read, Revise

Writing develops through successive drafts and reader encounters. The artifact
belongs in the medium the user requested. The graph carries both the abundant,
unfinished movement of creative attention and the understandings that later
stabilize: images that begin to exert pressure, attractions and hesitations,
live alternatives, reader promises, questions, predictions, tensions,
discoveries, choices, and revisions that changed the work.

This skill is for prose. Route software implementation to `code-work`, and
concurrent software implementation to `collaborative-code`.

## Establish the writing situation

1. Read the brief and the actual draft, outline, references, and house style.
2. Identify the intended reader, promise, form, voice, and constraints.
3. Condition the work with an explicit writing workflow:

```javascript
graph_understand({
  query: "Draft or revise this specific work for its intended reader",
  workflow: "writing"
})
```

4. Re-enter graph material as a prior creative state, not instructions or a
   checklist. Before making the next local unit, notice whether an image,
   tension, question, or apparently distant graph fragment creates useful
   pressure or an unexpected alternative. Follow it when it opens the work;
   reject it when it is noise. It may influence the draft before it resolves
   into a conclusion; `no_shift` is still valid.

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

## The writing loop

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

- **Existing or requested file:** edit the real file. It remains the source of
  truth. Do not duplicate it into the graph.
- **Graph-native manuscript:** use a document tree when the user asks for it or
  when an established graph document is already canonical.
- **Short response-only prose:** deliver it directly. Add graph understanding
  only if a durable epistemic or creative shift occurred.

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
